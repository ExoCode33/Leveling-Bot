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
 * FIXED: Double prefix issue in cache operations
 * PRIORITY: Redis first, but bot works 100% even if Redis fails
 * SUPPORTS: Railway environment variables and REDIS_URL format
 */
class ConnectionManager {
    constructor() {
        this.postgres = null;
        this.redis = null;
        this.redisConnected = false;
        this.postgresConnected = false;
        
        // Fallback cache for when Redis is down (in-memory)
        this.memoryCache = new Map();
        this.memoryCacheTTL = new Map();
        
        // Connection retry settings
        this.retryAttempts = 3;
        this.retryDelay = 5000; // 5 seconds
    }

    /**
     * Initialize both connections with fallbacks
     */
    async initialize() {
        console.log('🔄 Initializing database connections...');
        
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
            console.log('🗄️ Connecting to PostgreSQL...');
            
            this.postgres = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20, // Maximum pool connections
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000,
            });

            // Test connection
            const testClient = await this.postgres.connect();
            const result = await testClient.query('SELECT NOW() as current_time');
            console.log(`✅ PostgreSQL connected at ${result.rows[0].current_time}`);
            testClient.release();
            
            this.postgresConnected = true;
            
            // Connection event handlers
            this.postgres.on('error', (err) => {
                console.error('❌ PostgreSQL pool error:', err);
                this.postgresConnected = false;
            });

            this.postgres.on('connect', () => {
                if (!this.postgresConnected) {
                    console.log('🔄 PostgreSQL reconnected');
                    this.postgresConnected = true;
                }
            });

        } catch (error) {
            console.error('❌ PostgreSQL connection failed:', error.message);
            console.error('❌ CRITICAL: Bot cannot function without PostgreSQL!');
            throw new Error('PostgreSQL connection required for bot operation');
        }
    }

    /**
     * Initialize Redis (PRIORITIZED but OPTIONAL with fallback)
     * Supports both Railway REDIS_URL and individual variables (Railway + standard naming)
     */
    async initializeRedis() {
        // Check if Redis module is available
        if (!redisAvailable || !Redis) {
            console.warn('⚠️ Redis module not available - continuing without Redis caching');
            console.warn('⚠️ Install with: npm install ioredis');
            console.warn('⚠️ Bot functionality: 100% (performance: standard mode)');
            this.redisConnected = false;
            this.redis = null;
            return;
        }

        try {
            console.log('🔴 Connecting to Redis (priority mode)...');
            
            let redisConfig;
            
            // Check if REDIS_URL is provided (Railway format)
            if (process.env.REDIS_URL) {
                console.log('🔗 Using REDIS_URL connection string (Railway format)');
                redisConfig = {
                    connectString: process.env.REDIS_URL,
                    keyPrefix: 'Leveling-Bot:',
                    retryDelayOnFailover: 5000,
                    maxRetriesPerRequest: 2,
                    lazyConnect: true,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                    enableOfflineQueue: false,
                    family: 0,
                    retryDelayOnClusterDown: 10000,
                    retryDelayOnReconnect: 10000
                };
            } else {
                // Use individual Redis variables - SUPPORTS BOTH RAILWAY AND STANDARD NAMING
                const redisHost = process.env.REDIS_HOST || process.env.REDISHOST || 'localhost';
                const redisPort = parseInt(process.env.REDIS_PORT || process.env.REDISPORT) || 6379;
                const redisPassword = process.env.REDIS_PASSWORD || undefined;
                const redisDb = parseInt(process.env.REDIS_DB) || 0;
                
                redisConfig = {
                    host: redisHost,
                    port: redisPort,
                    password: redisPassword,
                    db: redisDb,
                    keyPrefix: 'Leveling-Bot:',
                    retryDelayOnFailover: 5000, // Slower retry: 5 seconds
                    maxRetriesPerRequest: 2, // Fewer retries
                    lazyConnect: true,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                    enableOfflineQueue: false,
                    family: 0,
                    retryDelayOnClusterDown: 10000, // 10 second delay on cluster down
                    retryDelayOnReconnect: 10000, // 10 second delay on reconnect
                };

                // Remove undefined password to avoid connection issues
                if (!redisConfig.password) {
                    delete redisConfig.password;
                }

                console.log(`🔴 Redis config: ${redisHost}:${redisPort} (DB: ${redisDb})`);
            }

            this.redis = new Redis(redisConfig);
            
            // Connection event handlers
            this.redis.on('connect', () => {
                console.log('✅ Redis connected successfully - OPTIMIZATION ACTIVE');
                this.redisConnected = true;
            });

            this.redis.on('error', (error) => {
                console.warn('⚠️ Redis connection error:', error.message);
                console.warn('⚠️ Falling back to in-memory caching - bot remains functional');
                this.redisConnected = false;
            });

            this.redis.on('close', () => {
                console.warn('🔌 Redis connection closed - using fallback cache');
                this.redisConnected = false;
            });

            this.redis.on('reconnecting', (delayMs) => {
                console.log(`🔄 Redis reconnecting in ${delayMs}ms...`);
            });

            this.redis.on('ready', () => {
                console.log('🚀 Redis ready - cache optimization enabled');
                this.redisConnected = true;
            });

            // Attempt to connect
            await this.redis.connect();
            
            // Test Redis connection
            const pong = await this.redis.ping();
            if (pong === 'PONG') {
                console.log('✅ Redis connection test successful - 95% faster canvas generation enabled');
                this.redisConnected = true;
            }

        } catch (error) {
            console.warn('⚠️ Redis connection failed:', error.message);
            console.warn('⚠️ Bot will continue without Redis caching (slower but fully functional)');
            console.warn('⚠️ To enable Redis: Check connection details and ensure Redis server is running');
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
     * Set cache value with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async setCache(key, value, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since RedisCacheManager already adds it or Redis config has keyPrefix
                await this.redis.setex(key, ttlSeconds, typeof value === 'object' ? JSON.stringify(value) : value);
                return true;
            } else {
                // FALLBACK: Use memory cache
                this.memoryCache.set(key, value);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached ${key} in memory (TTL: ${ttlSeconds}s)`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Redis error, falling back to memory:', error.message);
            // Auto-fallback to memory cache on Redis error
            this.memoryCache.set(key, value);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get cache value with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async getCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since Redis config handles keyPrefix
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
            console.error('[CACHE] Redis error, trying memory cache:', error.message);
            // Auto-fallback to memory cache on Redis error
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Delete cache key with Redis priority and memory fallback - FIXED: Prevent double prefix
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
            console.error('[CACHE] Error deleting cache, cleaning memory:', error.message);
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);
            return true;
        }
    }

    /**
     * Set binary cache (for images) with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async setBinaryCache(key, buffer, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since Redis config handles keyPrefix
                await this.redis.setex(key, ttlSeconds, buffer);
                return true;
            } else {
                // FALLBACK: Store buffer in memory cache
                this.memoryCache.set(key, buffer);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached binary ${key} in memory (${Math.round(buffer.length / 1024)}KB)`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Redis binary error, using memory:', error.message);
            // Auto-fallback to memory cache
            this.memoryCache.set(key, buffer);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get binary cache with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async getBinaryCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since Redis config handles keyPrefix
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
            console.error('[CACHE] Redis binary error, trying memory:', error.message);
            // Auto-fallback to memory cache
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Clear pattern with Redis priority and limited memory fallback - FIXED: Handle double prefix
     */
    async clearPattern(pattern) {
        try {
            let redisCleared = 0;
            
            if (this.isRedisAvailable()) {
                // FIXED: Handle both single and double prefix patterns
                const patterns = [
                    pattern,
                    pattern.replace('Leveling-Bot:', '') // Try without prefix since Redis config adds it
                ];
                
                for (const searchPattern of patterns) {
                    try {
                        const keys = await this.redis.keys(searchPattern);
                        if (keys.length > 0) {
                            // Note: Redis with keyPrefix will automatically add prefix to keys() results
                            const keysToDelete = keys.map(key => key.replace('Leveling-Bot:', ''));
                            await this.redis.del(...keysToDelete);
                            redisCleared += keys.length;
                            console.log(`[CACHE] Cleared ${keys.length} keys matching pattern: ${searchPattern}`);
                        }
                    } catch (patternError) {
                        console.log(`[CACHE] Pattern ${searchPattern} failed: ${patternError.message}`);
                    }
                }
            }
            
            // ALSO clear from memory cache (for consistency)
            let memoryCleared = 0;
            const searchTerm = pattern.replace(/\*/g, '').replace('Leveling-Bot:', '');
            for (const [key] of this.memoryCache) {
                if (key.includes(searchTerm)) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    memoryCleared++;
                }
            }
            
            const totalCleared = redisCleared + memoryCleared;
            if (totalCleared > 0) {
                console.log(`[CACHE] Cleared ${redisCleared} Redis + ${memoryCleared} memory keys`);
            }
            
            return totalCleared;
        } catch (error) {
            console.error('[CACHE] Error clearing pattern:', error.message);
            return 0;
        }
    }

    /**
     * Start memory cache cleanup (when Redis is down or as backup)
     */
    startMemoryCacheCleanup() {
        console.log('[FALLBACK] Starting memory cache cleanup timer (60s intervals)');
        
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
                console.log(`[FALLBACK] Cleaned up ${cleaned} expired memory cache entries`);
            }
        }, 60000); // Clean every minute
    }

    /**
     * Get connection health status
     */
    getHealthStatus() {
        return {
            postgresql: {
                connected: this.postgresConnected,
                status: this.postgresConnected ? '✅ Healthy' : '❌ Disconnected',
                required: true
            },
            redis: {
                connected: this.redisConnected,
                status: this.redisConnected ? '✅ Optimized' : '⚠️ Fallback Mode',
                required: false,
                fallbackActive: !this.redisConnected,
                priority: true,
                connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
            },
            cache: {
                type: this.redisConnected ? 'Redis (Optimized)' : 'In-Memory Fallback',
                entries: this.redisConnected ? 'Redis-managed' : this.memoryCache.size,
                status: '✅ Operational',
                performance: this.redisConnected ? 'Maximum' : 'Standard'
            }
        };
    }

    /**
     * Test all connections
     */
    async testConnections() {
        const results = {
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
            console.log('✅ PostgreSQL connection test passed');
        } catch (error) {
            console.error('❌ PostgreSQL connection test failed:', error.message);
            results.postgresqlError = error.message;
        }

        // Test Redis
        try {
            if (this.redis && this.redisConnected) {
                const pong = await this.redis.ping();
                results.redis = (pong === 'PONG');
                
                if (results.redis) {
                    // Get Redis info
                    const info = await this.redis.info('server');
                    results.redisDetails = {
                        version: info.match(/redis_version:([^\r\n]+)/)?.[1] || 'Unknown',
                        mode: info.match(/redis_mode:([^\r\n]+)/)?.[1] || 'standalone',
                        connectionType: process.env.REDIS_URL ? 'Railway URL' : 'Individual Variables'
                    };
                }
                
                console.log('✅ Redis connection test passed');
            } else {
                console.log('⚠️ Redis connection test skipped (using fallback mode)');
                results.redisDetails = { 
                    mode: 'fallback', 
                    reason: 'Not connected',
                    connectionType: process.env.REDIS_URL ? 'Railway URL (failed)' : 'Individual Variables (failed)'
                };
            }
        } catch (error) {
            console.error('❌ Redis connection test failed:', error.message);
            results.redisError = error.message;
        }

        return results;
    }

    /**
     * Attempt to reconnect Redis with priority handling
     */
    async reconnectRedis() {
        // Check if Redis module is available
        if (!redisAvailable || !Redis) {
            console.warn('⚠️ Cannot reconnect Redis - ioredis module not available');
            console.warn('⚠️ Install with: npm install ioredis');
            return false;
        }

        console.log('🔄 Attempting Redis reconnection (priority mode)...');
        
        try {
            if (this.redis) {
                await this.redis.disconnect();
                this.redis = null;
            }
            
            await this.initializeRedis();
            
            if (this.redisConnected) {
                console.log('✅ Redis reconnection successful - cache optimization restored');
                return true;
            } else {
                console.log('⚠️ Redis reconnection failed - continuing with memory fallback');
                return false;
            }
        } catch (error) {
            console.error('❌ Redis reconnection error:', error.message);
            console.warn('⚠️ Will retry Redis connection in 5 minutes');
            return false;
        }
    }

    /**
     * Get cache performance metrics
     */
    getCacheMetrics() {
        return {
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
     * Graceful shutdown
     */
    async shutdown() {
        console.log('🛑 Shutting down connections...');

        try {
            // Close Redis connection
            if (this.redis) {
                await this.redis.quit();
                console.log('✅ Redis connection closed');
            }

            // Close PostgreSQL pool
            if (this.postgres) {
                await this.postgres.end();
                console.log('✅ PostgreSQL connection pool closed');
            }

            // Clear memory cache
            this.memoryCache.clear();
            this.memoryCacheTTL.clear();
            console.log('✅ Memory cache cleared');

        } catch (error) {
            console.error('❌ Error during connection shutdown:', error);
        }
    }
}

module.exports = ConnectionManager;
