const { Pool } = require('pg');

// Try to load Redis, but make it optional - handle require-time errors
let Redis = null;
let redisAvailable = false;

try {
    Redis = require('ioredis');
    redisAvailable = true;
    console.log('📦 ioredis module loaded successfully');
} catch (error) {
    console.warn('⚠️ ioredis module not found - Redis caching disabled');
    console.warn('⚠️ To enable Redis caching: npm install ioredis');
    console.warn('⚠️ Bot will continue with in-memory fallback cache');
    Redis = null;
    redisAvailable = false;
}

/**
 * ConnectionManager - Handles PostgreSQL and Redis connections with graceful fallbacks
 * ENHANCED: Environment variable support for multi-bot Redis configuration
 * SUPPORTS: Railway environment variables and REDIS_URL format
 */
class ConnectionManager {
    constructor(botType = null) {
        // Determine bot type from environment or parameter
        this.botType = botType || process.env.BOT_TYPE || 'xp';
        
        this.postgres = null;
        this.redis = null;
        this.redisConnected = false;
        this.postgresConnected = false;
        
        // Get Redis database and prefix from environment variables
        this.redisDB = parseInt(process.env.REDIS_DB) || this.getDefaultDB(this.botType);
        this.keyPrefix = process.env.REDIS_KEY_PREFIX || this.getDefaultPrefix(this.botType);
        
        console.log(`🔧 ConnectionManager initialized for ${this.botType.toUpperCase()} bot`);
        console.log(`🔧 Redis DB: ${this.redisDB}, Key Prefix: ${this.keyPrefix}`);
        
        // Fallback cache for when Redis is down (in-memory)
        this.memoryCache = new Map();
        this.memoryCacheTTL = new Map();
        
        // Connection retry settings
        this.retryAttempts = parseInt(process.env.REDIS_RETRY_ATTEMPTS) || 3;
        this.retryDelay = parseInt(process.env.REDIS_RETRY_DELAY) || 5000;
    }

    /**
     * Get default database number for bot type
     */
    getDefaultDB(botType) {
        const mapping = {
            'xp': 0,
            'leveling': 0,
            'verification': 1,
            'verify': 1,
            'gacha': 2,
            'quiz': 3,
            'music': 4,
            'moderation': 5,
            'economy': 6,
            'utility': 7
        };
        return mapping[botType.toLowerCase()] || 0;
    }

    /**
     * Get default key prefix for bot type
     */
    getDefaultPrefix(botType) {
        const mapping = {
            'xp': 'Leveling-Bot:',
            'leveling': 'Leveling-Bot:',
            'verification': 'Verify-Bot:',
            'verify': 'Verify-Bot:',
            'gacha': 'Gacha-Bot:',
            'quiz': 'Quiz-Bot:',
            'music': 'Music-Bot:',
            'moderation': 'Mod-Bot:',
            'economy': 'Economy-Bot:',
            'utility': 'Utility-Bot:'
        };
        return mapping[botType.toLowerCase()] || `${botType.toUpperCase()}-Bot:`;
    }

    /**
     * Initialize both connections with enhanced configuration
     */
    async initialize() {
        console.log(`🔄 Initializing ${this.botType.toUpperCase()} bot connections...`);
        
        // PostgreSQL is REQUIRED - bot cannot function without it
        await this.initializePostgreSQL();
        
        // Redis is PRIORITIZED but OPTIONAL - bot works without it, just slower
        await this.initializeRedis();
        
        // Start memory cache cleanup if Redis is down
        if (!this.redisConnected) {
            this.startMemoryCacheCleanup();
        }
        
        return {
            postgres: this.postgresConnected,
            redis: this.redisConnected
        };
    }

    /**
     * Initialize PostgreSQL (REQUIRED)
     */
    async initializePostgreSQL() {
        try {
            console.log(`🗄️ ${this.botType.toUpperCase()}: Connecting to PostgreSQL...`);
            
            this.postgres = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20, // Maximum pool connections
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000,
            });

            // Test connection
            const testClient = await this.postgres.connect();
            const result = await testClient.query('SELECT NOW() as current_time');
            console.log(`✅ ${this.botType.toUpperCase()}: PostgreSQL connected at ${result.rows[0].current_time}`);
            testClient.release();
            
            this.postgresConnected = true;
            
            // Connection event handlers
            this.postgres.on('error', (err) => {
                console.error(`❌ ${this.botType.toUpperCase()}: PostgreSQL pool error:`, err);
                this.postgresConnected = false;
            });

            this.postgres.on('connect', () => {
                if (!this.postgresConnected) {
                    console.log(`🔄 ${this.botType.toUpperCase()}: PostgreSQL reconnected`);
                    this.postgresConnected = true;
                }
            });

        } catch (error) {
            console.error(`❌ ${this.botType.toUpperCase()}: PostgreSQL connection failed:`, error.message);
            console.error(`❌ CRITICAL: ${this.botType} bot cannot function without PostgreSQL!`);
            throw new Error('PostgreSQL connection required for bot operation');
        }
    }

    /**
     * Initialize Redis with enhanced environment variable support
     */
    async initializeRedis() {
        // Check if Redis module is available
        if (!redisAvailable || !Redis) {
            console.warn(`⚠️ ${this.botType.toUpperCase()}: Redis module not available - continuing without Redis caching`);
            console.warn('⚠️ Install with: npm install ioredis');
            console.warn(`⚠️ ${this.botType} bot functionality: 100% (performance: standard mode)`);
            this.redisConnected = false;
            this.redis = null;
            return;
        }

        try {
            console.log(`🔴 Connecting to Redis for ${this.botType.toUpperCase()} Bot...`);
            console.log(`🔴 Target DB: ${this.redisDB}, Key Prefix: ${this.keyPrefix}`);
            
            let redisConfig;
            
            // Check if REDIS_URL is provided (Railway format)
            if (process.env.REDIS_URL) {
                console.log(`🔗 Using REDIS_URL for ${this.botType} bot (DB: ${this.redisDB})`);
                
                // Parse REDIS_URL and modify for specific database
                const url = new URL(process.env.REDIS_URL);
                url.pathname = `/${this.redisDB}`; // Set database number from env
                
                redisConfig = {
                    connectString: url.toString(),
                    keyPrefix: this.keyPrefix,
                    retryDelayOnFailover: this.retryDelay,
                    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST) || 2,
                    lazyConnect: true,
                    connectTimeout: parseInt(process.env.REDIS_CONNECTION_TIMEOUT) || 10000,
                    commandTimeout: 5000,
                    enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE === 'true',
                    family: 0,
                    retryDelayOnClusterDown: 10000,
                    retryDelayOnReconnect: 10000
                };
            } else {
                // Use individual Redis variables - SUPPORTS BOTH RAILWAY AND STANDARD NAMING
                const redisHost = process.env.REDIS_HOST || process.env.REDISHOST || 'localhost';
                const redisPort = parseInt(process.env.REDIS_PORT || process.env.REDISPORT) || 6379;
                const redisPassword = process.env.REDIS_PASSWORD || undefined;
                
                redisConfig = {
                    host: redisHost,
                    port: redisPort,
                    password: redisPassword,
                    db: this.redisDB, // Use environment variable
                    keyPrefix: this.keyPrefix, // Use environment variable
                    retryDelayOnFailover: this.retryDelay,
                    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST) || 2,
                    lazyConnect: true,
                    connectTimeout: parseInt(process.env.REDIS_CONNECTION_TIMEOUT) || 10000,
                    commandTimeout: 5000,
                    enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE === 'true',
                    family: 0,
                    retryDelayOnClusterDown: 10000,
                    retryDelayOnReconnect: 10000
                };

                // Remove undefined password to avoid connection issues
                if (!redisConfig.password) {
                    delete redisConfig.password;
                }

                console.log(`🔴 ${this.botType.toUpperCase()} Bot Redis config: ${redisHost}:${redisPort} (DB: ${this.redisDB})`);
            }

            this.redis = new Redis(redisConfig);
            
            // Enhanced connection event handlers
            this.redis.on('connect', () => {
                console.log(`✅ ${this.botType.toUpperCase()} Bot Redis connected successfully - OPTIMIZATION ACTIVE`);
                this.redisConnected = true;
            });

            this.redis.on('error', (error) => {
                console.warn(`⚠️ ${this.botType.toUpperCase()} Bot Redis connection error:`, error.message);
                console.warn(`⚠️ Falling back to in-memory caching - ${this.botType} bot remains functional`);
                this.redisConnected = false;
            });

            this.redis.on('close', () => {
                console.warn(`🔌 ${this.botType.toUpperCase()} Bot Redis connection closed - using fallback cache`);
                this.redisConnected = false;
            });

            this.redis.on('reconnecting', (delayMs) => {
                console.log(`🔄 ${this.botType.toUpperCase()} Bot Redis reconnecting in ${delayMs}ms...`);
            });

            this.redis.on('ready', () => {
                console.log(`🚀 ${this.botType.toUpperCase()} Bot Redis ready on DB ${this.redisDB} - cache optimization enabled`);
                this.redisConnected = true;
            });

            // Attempt to connect
            await this.redis.connect();
            
            // Test Redis connection with database verification
            const pong = await this.redis.ping();
            if (pong === 'PONG') {
                // Verify we're on the correct database
                const dbSize = await this.redis.dbsize();
                console.log(`✅ ${this.botType.toUpperCase()} Bot Redis connection test successful`);
                console.log(`✅ Connected to DB ${this.redisDB} with ${dbSize} keys and prefix "${this.keyPrefix}"`);
                this.redisConnected = true;
            }

        } catch (error) {
            console.warn(`⚠️ ${this.botType.toUpperCase()} Bot Redis connection failed:`, error.message);
            console.warn(`⚠️ ${this.botType} bot will continue without Redis caching (slower but fully functional)`);
            this.redisConnected = false;
            this.redis = null;
        }
    }

    /**
     * Get PostgreSQL connection
     */
    getPostgreSQL() {
        if (!this.postgresConnected || !this.postgres) {
            throw new Error('PostgreSQL connection not available');
        }
        return this.postgres;
    }

    /**
     * Get Redis connection (returns null if not available)
     */
    getRedis() {
        return this.redisConnected ? this.redis : null;
    }

    /**
     * Check if Redis is available
     */
    isRedisAvailable() {
        return this.redisConnected && this.redis !== null;
    }

    /**
     * Check if PostgreSQL is available
     */
    isPostgresAvailable() {
        return this.postgresConnected && this.postgres !== null;
    }

    /**
     * FALLBACK CACHING - In-memory cache when Redis is down
     */

    /**
     * Set cache value with Redis priority and memory fallback - Enhanced with TTL from env
     */
    async setCache(key, value, ttlSeconds = null) {
        // Use environment variable for TTL if not specified
        if (!ttlSeconds) {
            if (key.includes('avatar')) ttlSeconds = parseInt(process.env.CACHE_AVATAR_TTL) || 43200;
            else if (key.includes('poster')) ttlSeconds = parseInt(process.env.CACHE_POSTER_TTL) || 86400;
            else if (key.includes('leaderboard')) ttlSeconds = parseInt(process.env.CACHE_LEADERBOARD_TTL) || 300;
            else ttlSeconds = 3600; // Default 1 hour
        }

        try {
            if (this.isRedisAvailable()) {
                // Redis with keyPrefix handles prefix automatically
                await this.redis.setex(key, ttlSeconds, typeof value === 'object' ? JSON.stringify(value) : value);
                return true;
            } else {
                // FALLBACK: Use memory cache
                this.memoryCache.set(key, value);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] ${this.botType.toUpperCase()}: Cached ${key} in memory (TTL: ${ttlSeconds}s)`);
                return true;
            }
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Redis error, falling back to memory:`, error.message);
            // Auto-fallback to memory cache on Redis error
            this.memoryCache.set(key, value);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get cache value with Redis priority and memory fallback
     */
    async getCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // Redis with keyPrefix handles prefix automatically
                const value = await this.redis.get(key);
                if (value) {
                    try {
                        return JSON.parse(value);
                    } catch {
                        return value; // Return as string if not JSON
                    }
                }
                return null;
            } else {
                // FALLBACK: Use memory cache
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    // Expired
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const value = this.memoryCache.get(key);
                if (value !== undefined) {
                    return value;
                }
                return null;
            }
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Redis error, trying memory cache:`, error.message);
            // Auto-fallback to memory cache on Redis error
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Delete cache key with Redis priority and memory fallback
     */
    async deleteCache(key) {
        try {
            if (this.isRedisAvailable()) {
                await this.redis.del(key);
            }
            // Also delete from memory cache (in case of fallback scenarios)
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);
            return true;
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Error deleting cache, cleaning memory:`, error.message);
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);
            return true;
        }
    }

    /**
     * Set binary cache (for images) with Redis priority and memory fallback
     */
    async setBinaryCache(key, buffer, ttlSeconds = null) {
        // Use environment variable for TTL if not specified
        if (!ttlSeconds) {
            ttlSeconds = parseInt(process.env.CACHE_AVATAR_TTL) || 43200; // Default for binary is avatar TTL
        }

        try {
            if (this.isRedisAvailable()) {
                // Redis with keyPrefix handles prefix automatically
                await this.redis.setex(key, ttlSeconds, buffer);
                return true;
            } else {
                // FALLBACK: Store buffer in memory cache
                this.memoryCache.set(key, buffer);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] ${this.botType.toUpperCase()}: Cached binary ${key} in memory (${Math.round(buffer.length / 1024)}KB)`);
                return true;
            }
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Redis binary error, using memory:`, error.message);
            // Auto-fallback to memory cache
            this.memoryCache.set(key, buffer);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get binary cache with Redis priority and memory fallback
     */
    async getBinaryCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // Redis with keyPrefix handles prefix automatically
                return await this.redis.getBuffer(key);
            } else {
                // FALLBACK: Get from memory cache
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const buffer = this.memoryCache.get(key);
                if (buffer) {
                    return buffer;
                }
                return null;
            }
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Redis binary error, trying memory:`, error.message);
            // Auto-fallback to memory cache
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Clear pattern with Redis priority and limited memory fallback
     */
    async clearPattern(pattern) {
        try {
            let redisCleared = 0;
            
            if (this.isRedisAvailable()) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    // Remove keyPrefix from keys since Redis automatically adds it
                    const keysToDelete = keys.map(key => key.replace(this.keyPrefix, ''));
                    await this.redis.del(...keysToDelete);
                    redisCleared += keys.length;
                    console.log(`[CACHE] ${this.botType.toUpperCase()}: Cleared ${keys.length} keys matching pattern: ${pattern}`);
                }
            }
            
            // ALSO clear from memory cache (for consistency)
            let memoryCleared = 0;
            const searchTerm = pattern.replace(/\*/g, '').replace(this.keyPrefix, '');
            for (const [key] of this.memoryCache) {
                if (key.includes(searchTerm)) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    memoryCleared++;
                }
            }
            
            const totalCleared = redisCleared + memoryCleared;
            if (totalCleared > 0) {
                console.log(`[CACHE] ${this.botType.toUpperCase()}: Cleared ${redisCleared} Redis + ${memoryCleared} memory keys`);
            }
            
            return totalCleared;
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Error clearing pattern:`, error.message);
            return 0;
        }
    }

    /**
     * Start memory cache cleanup (when Redis is down or as backup)
     */
    startMemoryCacheCleanup() {
        console.log(`[FALLBACK] ${this.botType.toUpperCase()}: Starting memory cache cleanup timer (60s intervals)`);
        
        setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            
            for (const [key, expiry] of this.memoryCacheTTL) {
                if (now > expiry) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                console.log(`[FALLBACK] ${this.botType.toUpperCase()}: Cleaned up ${cleaned} expired memory cache entries`);
            }
        }, 60000); // Clean every minute
    }

    /**
     * Enhanced health status with environment info
     */
    getHealthStatus() {
        return {
            botType: this.botType.toUpperCase(),
            environment: {
                redisDB: this.redisDB,
                keyPrefix: this.keyPrefix,
                configuredFromEnv: {
                    db: !!process.env.REDIS_DB,
                    prefix: !!process.env.REDIS_KEY_PREFIX,
                    botType: !!process.env.BOT_TYPE
                }
            },
            postgresql: {
                connected: this.postgresConnected,
                status: this.postgresConnected ? '✅ Healthy' : '❌ Disconnected',
                required: true
            },
            redis: {
                connected: this.redisConnected,
                status: this.redisConnected ? `✅ Optimized (DB: ${this.redisDB})` : '⚠️ Fallback Mode',
                database: this.redisDB,
                keyPrefix: this.keyPrefix,
                required: false,
                fallbackActive: !this.redisConnected,
                priority: true,
                connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
            },
            cache: {
                type: this.redisConnected ? `Redis DB${this.redisDB} (Optimized)` : 'In-Memory Fallback',
                entries: this.redisConnected ? 'Redis-managed' : this.memoryCache.size,
                status: '✅ Operational',
                performance: this.redisConnected ? 'Maximum' : 'Standard',
                prefix: this.keyPrefix
            }
        };
    }

    /**
     * Test all connections
     */
    async testConnections() {
        const results = {
            botType: this.botType.toUpperCase(),
            targetDatabase: this.redisDB,
            postgresql: false,
            redis: false,
            redisDetails: null,
            timestamp: new Date().toISOString()
        };

        // Test PostgreSQL
        try {
            const client = await this.postgres.connect();
            await client.query('SELECT 1');
            client.release();
            results.postgresql = true;
            console.log(`✅ ${this.botType.toUpperCase()}: PostgreSQL connection test passed`);
        } catch (error) {
            console.error(`❌ ${this.botType.toUpperCase()}: PostgreSQL connection test failed:`, error.message);
            results.postgresqlError = error.message;
        }

        // Test Redis
        try {
            if (this.redis && this.redisConnected) {
                const pong = await this.redis.ping();
                results.redis = (pong === 'PONG');
                
                if (results.redis) {
                    // Get Redis info including database
                    const info = await this.redis.info('server');
                    const dbSize = await this.redis.dbsize();
                    
                    results.redisDetails = {
                        version: info.match(/redis_version:([^\r\n]+)/)?.[1] || 'Unknown',
                        mode: info.match(/redis_mode:([^\r\n]+)/)?.[1] || 'standalone',
                        database: this.redisDB,
                        keyPrefix: this.keyPrefix,
                        entries: dbSize,
                        botType: this.botType.toUpperCase(),
                        connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
                    };
                }
                
                console.log(`✅ ${this.botType.toUpperCase()}: Redis connection test passed (DB: ${this.redisDB})`);
            } else {
                console.log(`⚠️ ${this.botType.toUpperCase()}: Redis connection test skipped (using fallback mode)`);
                results.redisDetails = { 
                    mode: 'fallback', 
                    reason: 'Not connected',
                    database: this.redisDB,
                    keyPrefix: this.keyPrefix,
                    botType: this.botType.toUpperCase(),
                    connectionType: process.env.REDIS_URL ? 'Railway URL (failed)' : 'Individual Variables (failed)'
                };
            }
        } catch (error) {
            console.error(`❌ ${this.botType.toUpperCase()}: Redis connection test failed:`, error.message);
            results.redisError = error.message;
        }

        return results;
    }

    /**
     * Attempt to reconnect Redis with enhanced bot-specific handling
     */
    async reconnectRedis() {
        // Check if Redis module is available
        if (!redisAvailable || !Redis) {
            console.warn(`⚠️ ${this.botType.toUpperCase()}: Cannot reconnect Redis - ioredis module not available`);
            console.warn('⚠️ Install with: npm install ioredis');
            return false;
        }

        console.log(`🔄 ${this.botType.toUpperCase()}: Attempting Redis reconnection...`);
        
        try {
            if (this.redis) {
                await this.redis.disconnect();
                this.redis = null;
            }
            
            await this.initializeRedis();
            
            if (this.redisConnected) {
                console.log(`✅ ${this.botType.toUpperCase()}: Redis reconnection successful - cache optimization restored`);
                return true;
            } else {
                console.log(`⚠️ ${this.botType.toUpperCase()}: Redis reconnection failed - continuing with memory fallback`);
                return false;
            }
        } catch (error) {
            console.error(`❌ ${this.botType.toUpperCase()}: Redis reconnection error:`, error.message);
            console.warn(`⚠️ ${this.botType} will retry Redis connection in 5 minutes`);
            return false;
        }
    }

    /**
     * Enhanced cache performance metrics
     */
    getCacheMetrics() {
        return {
            botType: this.botType.toUpperCase(),
            database: this.redisDB,
            keyPrefix: this.keyPrefix,
            redis: {
                available: this.isRedisAvailable(),
                connected: this.redisConnected,
                priority: true,
                connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
            },
            memory: {
                entries: this.memoryCache.size,
                ttlEntries: this.memoryCacheTTL.size,
                isActive: !this.redisConnected || this.memoryCache.size > 0
            },
            performance: {
                mode: this.redisConnected ? 'optimized' : 'fallback',
                expectedSpeedup: this.redisConnected ? '95%' : '0%',
                canvasGeneration: this.redisConnected ? '~200ms' : '~2000ms',
                userStats: this.redisConnected ? '~50ms' : '~500ms'
            }
        };
    }

    /**
     * Debug environment configuration
     */
    debugEnvironmentConfig() {
        console.log(`🔍 [${this.botType.toUpperCase()}] Environment Configuration:`);
        console.log(`  Bot Type: ${this.botType}`);
        console.log(`  Redis DB: ${this.redisDB} (from ${process.env.REDIS_DB ? 'env' : 'default'})`);
        console.log(`  Key Prefix: ${this.keyPrefix} (from ${process.env.REDIS_KEY_PREFIX ? 'env' : 'default'})`);
        console.log(`  Redis Host: ${process.env.REDIS_HOST || process.env.REDISHOST || 'default'}`);
        console.log(`  Redis Port: ${process.env.REDIS_PORT || process.env.REDISPORT || 'default'}`);
        console.log(`  Redis URL: ${process.env.REDIS_URL ? 'configured' : 'not set'}`);
        console.log(`  Connection Timeout: ${process.env.REDIS_CONNECTION_TIMEOUT || 'default'}`);
        console.log(`  Retry Attempts: ${this.retryAttempts}`);
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log(`🛑 ${this.botType.toUpperCase()}: Shutting down connections...`);

        try {
            // Close Redis connection
            if (this.redis) {
                await this.redis.quit();
                console.log(`✅ ${this.botType.toUpperCase()}: Redis connection closed`);
            }

            // Close PostgreSQL pool
            if (this.postgres) {
                await this.postgres.end();
                console.log(`✅ ${this.botType.toUpperCase()}: PostgreSQL connection pool closed`);
            }

            // Clear memory cache
            this.memoryCache.clear();
            this.memoryCacheTTL.clear();
            console.log(`✅ ${this.botType.toUpperCase()}: Memory cache cleared`);

        } catch (error) {
            console.error(`❌ ${this.botType.toUpperCase()}: Error during connection shutdown:`, error);
        }
    }

    /**
     * Enhanced cache information with environment details
     */
    async getCacheInfo() {
        try {
            if (!this.isRedisAvailable()) {
                return {
                    botType: this.botType.toUpperCase(),
                    mode: 'In-Memory Fallback',
                    database: this.redisDB,
                    keyPrefix: this.keyPrefix,
                    entries: this.memoryCache.size,
                    redis: false,
                    environment: {
                        configuredFromEnv: !!process.env.REDIS_DB,
                        prefixFromEnv: !!process.env.REDIS_KEY_PREFIX
                    }
                };
            }

            const dbSize = await this.redis.dbsize();
            const info = await this.redis.info('memory');
            
            return {
                botType: this.botType.toUpperCase(),
                mode: 'Redis',
                database: this.redisDB,
                keyPrefix: this.keyPrefix,
                entries: dbSize,
                redis: true,
                memory: {
                    used: info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown',
                    peak: info.match(/used_memory_peak_human:([^\r\n]+)/)?.[1] || 'Unknown',
                    fragmentation: info.match(/mem_fragmentation_ratio:([0-9.]+)/)?.[1] || 'Unknown'
                },
                environment: {
                    configuredFromEnv: !!process.env.REDIS_DB,
                    prefixFromEnv: !!process.env.REDIS_KEY_PREFIX,
                    connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
                }
            };
        } catch (error) {
            console.error(`[CACHE] ${this.botType.toUpperCase()} Error getting cache info:`, error);
            return { 
                botType: this.botType.toUpperCase(),
                mode: 'Error', 
                error: error.message 
            };
        }
    }

    /**
     * Test cache functionality with bot-specific testing
     */
    async testCache() {
        try {
            const testKey = `test:${this.botType}:${Date.now()}`;
            const testValue = `cache-test-${this.botType}-${Date.now()}`;
            
            console.log(`[CACHE TEST] ${this.botType.toUpperCase()}: Testing cache functionality...`);
            
            // Test set operation
            const setResult = await this.setCache(testKey, testValue, 60);
            if (!setResult) {
                return { 
                    success: false, 
                    error: 'Cache set operation failed',
                    botType: this.botType.toUpperCase() 
                };
            }
            
            // Test get operation
            const getValue = await this.getCache(testKey);
            if (getValue !== testValue) {
                return { 
                    success: false, 
                    error: `Cache get failed: expected '${testValue}', got '${getValue}'`,
                    botType: this.botType.toUpperCase()
                };
            }
            
            // Test delete operation
            await this.deleteCache(testKey);
            const deletedValue = await this.getCache(testKey);
            if (deletedValue !== null) {
                return { 
                    success: false, 
                    error: 'Cache delete operation failed',
                    botType: this.botType.toUpperCase()
                };
            }
            
            console.log(`[CACHE TEST] ${this.botType.toUpperCase()}: Cache test passed successfully`);
            return { 
                success: true, 
                message: `Cache test passed for ${this.botType.toUpperCase()} bot`,
                database: this.redisDB,
                keyPrefix: this.keyPrefix,
                mode: this.redisConnected ? 'Redis' : 'Memory Fallback'
            };
            
        } catch (error) {
            console.error(`[CACHE TEST] ${this.botType.toUpperCase()}: Cache test error:`, error);
            return { 
                success: false, 
                error: error.message,
                botType: this.botType.toUpperCase()
            };
        }
    }

    /**
     * Get detailed Redis database information
     */
    async getRedisDBInfo() {
        try {
            if (!this.isRedisAvailable()) {
                return {
                    available: false,
                    reason: 'Redis not connected',
                    botType: this.botType.toUpperCase(),
                    targetDB: this.redisDB
                };
            }

            const info = await this.redis.info('keyspace');
            const dbSize = await this.redis.dbsize();
            const memory = await this.redis.info('memory');
            
            return {
                available: true,
                botType: this.botType.toUpperCase(),
                database: this.redisDB,
                keyPrefix: this.keyPrefix,
                keyCount: dbSize,
                keyspaceInfo: info,
                memoryUsage: {
                    used: memory.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown',
                    peak: memory.match(/used_memory_peak_human:([^\r\n]+)/)?.[1] || 'Unknown'
                }
            };
            
        } catch (error) {
            console.error(`[REDIS INFO] ${this.botType.toUpperCase()}: Error getting Redis DB info:`, error);
            return {
                available: false,
                error: error.message,
                botType: this.botType.toUpperCase()
            };
        }
    }

    /**
     * Monitor cache performance
     */
    async monitorCachePerformance(duration = 60000) {
        console.log(`[PERFORMANCE] ${this.botType.toUpperCase()}: Starting cache performance monitoring for ${duration/1000}s...`);
        
        const startTime = Date.now();
        let operations = 0;
        let errors = 0;
        
        const monitor = setInterval(async () => {
            try {
                const testKey = `perf:${this.botType}:${Date.now()}`;
                const testValue = `performance-test-${operations}`;
                
                await this.setCache(testKey, testValue, 10);
                await this.getCache(testKey);
                await this.deleteCache(testKey);
                
                operations += 3; // Set, Get, Delete = 3 operations
            } catch (error) {
                errors++;
                console.error(`[PERFORMANCE] ${this.botType.toUpperCase()}: Cache operation error:`, error.message);
            }
        }, 1000); // Test every second
        
        return new Promise((resolve) => {
            setTimeout(() => {
                clearInterval(monitor);
                const endTime = Date.now();
                const actualDuration = endTime - startTime;
                
                const results = {
                    botType: this.botType.toUpperCase(),
                    database: this.redisDB,
                    keyPrefix: this.keyPrefix,
                    duration: actualDuration,
                    operations,
                    errors,
                    operationsPerSecond: Math.round((operations / actualDuration) * 1000),
                    errorRate: Math.round((errors / operations) * 100) || 0,
                    mode: this.redisConnected ? 'Redis' : 'Memory Fallback'
                };
                
                console.log(`[PERFORMANCE] ${this.botType.toUpperCase()}: Performance test complete:`, results);
                resolve(results);
            }, duration);
        });
    }

    /**
     * Cleanup memory and optimize performance
     */
    async optimizeCache() {
        try {
            console.log(`[OPTIMIZE] ${this.botType.toUpperCase()}: Starting cache optimization...`);
            
            let optimized = 0;
            
            // Clean up expired memory cache entries
            const now = Date.now();
            for (const [key, expiry] of this.memoryCacheTTL) {
                if (now > expiry) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    optimized++;
                }
            }
            
            // If Redis is available, run optimization commands
            if (this.isRedisAvailable()) {
                try {
                    // Run Redis memory optimization (removes expired keys)
                    await this.redis.memory('purge');
                    optimized++;
                    
                    // Get memory stats before and after
                    const info = await this.redis.info('memory');
                    const memoryUsed = info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown';
                    
                    console.log(`[OPTIMIZE] ${this.botType.toUpperCase()}: Redis memory after optimization: ${memoryUsed}`);
                } catch (redisOptimizeError) {
                    console.log(`[OPTIMIZE] ${this.botType.toUpperCase()}: Redis optimization skipped:`, redisOptimizeError.message);
                }
            }
            
            console.log(`[OPTIMIZE] ${this.botType.toUpperCase()}: Optimization complete - ${optimized} operations performed`);
            
            return {
                success: true,
                operations: optimized,
                botType: this.botType.toUpperCase(),
                database: this.redisDB,
                memoryCleared: optimized
            };
            
        } catch (error) {
            console.error(`[OPTIMIZE] ${this.botType.toUpperCase()}: Cache optimization error:`, error);
            return {
                success: false,
                error: error.message,
                botType: this.botType.toUpperCase()
            };
        }
    }

    /**
     * Export configuration for debugging
     */
    exportConfig() {
        return {
            botType: this.botType,
            redis: {
                database: this.redisDB,
                keyPrefix: this.keyPrefix,
                connected: this.redisConnected,
                host: process.env.REDIS_HOST || process.env.REDISHOST,
                port: process.env.REDIS_PORT || process.env.REDISPORT,
                hasUrl: !!process.env.REDIS_URL,
                retryAttempts: this.retryAttempts,
                retryDelay: this.retryDelay
            },
            postgres: {
                connected: this.postgresConnected,
                hasUrl: !!process.env.DATABASE_URL
            },
            environment: {
                nodeEnv: process.env.NODE_ENV,
                configuredFromEnv: {
                    botType: !!process.env.BOT_TYPE,
                    redisDB: !!process.env.REDIS_DB,
                    keyPrefix: !!process.env.REDIS_KEY_PREFIX
                }
            },
            cache: {
                memoryEntries: this.memoryCache.size,
                memoryTTLEntries: this.memoryCacheTTL.size
            }
        };
    }
}

module.exports = ConnectionManager;
