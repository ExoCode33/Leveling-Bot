const { Pool } = require('pg');
const Redis = require('ioredis');

/**
 * ConnectionManager - Handles PostgreSQL and Redis connections with graceful fallbacks
 * Bot works 100% even if Redis fails, just without caching optimizations
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
        
        // Redis is OPTIONAL - bot works without it, just slower
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
     * Initialize Redis (OPTIONAL with fallback)
     */
    async initializeRedis() {
        try {
            console.log('🔴 Connecting to Redis...');
            
            const redisConfig = {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: process.env.REDIS_DB || 0,
                keyPrefix: 'Leveling-Bot:',
                retryDelayOnFailover: 1000,
                maxRetriesPerRequest: 3,
                lazyConnect: true,
                connectTimeout: 10000,
                commandTimeout: 5000,
                enableOfflineQueue: false // Don't queue commands when disconnected
            };

            this.redis = new Redis(redisConfig);
            
            // Connection event handlers
            this.redis.on('connect', () => {
                console.log('✅ Redis connected successfully');
                this.redisConnected = true;
            });

            this.redis.on('error', (error) => {
                console.warn('⚠️ Redis connection error:', error.message);
                console.warn('⚠️ Falling back to in-memory caching');
                this.redisConnected = false;
            });

            this.redis.on('close', () => {
                console.warn('🔌 Redis connection closed');
                this.redisConnected = false;
            });

            this.redis.on('reconnecting', () => {
                console.log('🔄 Redis reconnecting...');
            });

            // Attempt to connect
            await this.redis.connect();
            
            // Test Redis connection
            const pong = await this.redis.ping();
            if (pong === 'PONG') {
                console.log('✅ Redis connection test successful');
                this.redisConnected = true;
            }

        } catch (error) {
            console.warn('⚠️ Redis connection failed:', error.message);
            console.warn('⚠️ Bot will continue without Redis caching (slower but functional)');
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
     * Set cache value with fallback
     */
    async setCache(key, value, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                // Use Redis if available
                await this.redis.setex(key, ttlSeconds, typeof value === 'object' ? JSON.stringify(value) : value);
                return true;
            } else {
                // Fallback to memory cache
                this.memoryCache.set(key, value);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached ${key} in memory (TTL: ${ttlSeconds}s)`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Error setting cache:', error);
            return false;
        }
    }

    /**
     * Get cache value with fallback
     */
    async getCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // Use Redis if available
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
                // Fallback to memory cache
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    // Expired
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const value = this.memoryCache.get(key);
                if (value !== undefined) {
                    console.log(`[FALLBACK] Retrieved ${key} from memory cache`);
                    return value;
                }
                return null;
            }
        } catch (error) {
            console.error('[CACHE] Error getting cache:', error);
            return null;
        }
    }

    /**
     * Delete cache key with fallback
     */
    async deleteCache(key) {
        try {
            if (this.isRedisAvailable()) {
                await this.redis.del(key);
            } else {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
            }
            return true;
        } catch (error) {
            console.error('[CACHE] Error deleting cache:', error);
            return false;
        }
    }

    /**
     * Set binary cache (for images) with fallback
     */
    async setBinaryCache(key, buffer, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                await this.redis.setex(key, ttlSeconds, buffer);
                return true;
            } else {
                // Store buffer in memory cache
                this.memoryCache.set(key, buffer);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached binary ${key} in memory`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Error setting binary cache:', error);
            return false;
        }
    }

    /**
     * Get binary cache with fallback
     */
    async getBinaryCache(key) {
        try {
            if (this.isRedisAvailable()) {
                return await this.redis.getBuffer(key);
            } else {
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const buffer = this.memoryCache.get(key);
                if (buffer) {
                    console.log(`[FALLBACK] Retrieved binary ${key} from memory cache`);
                    return buffer;
                }
                return null;
            }
        } catch (error) {
            console.error('[CACHE] Error getting binary cache:', error);
            return null;
        }
    }

    /**
     * Clear pattern (only works with Redis, limited fallback)
     */
    async clearPattern(pattern) {
        try {
            if (this.isRedisAvailable()) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                    return keys.length;
                }
                return 0;
            } else {
                // Limited pattern support for memory cache
                let cleared = 0;
                for (const [key] of this.memoryCache) {
                    if (key.includes(pattern.replace('*', ''))) {
                        this.memoryCache.delete(key);
                        this.memoryCacheTTL.delete(key);
                        cleared++;
                    }
                }
                console.log(`[FALLBACK] Cleared ${cleared} keys matching pattern from memory`);
                return cleared;
            }
        } catch (error) {
            console.error('[CACHE] Error clearing pattern:', error);
            return 0;
        }
    }

    /**
     * Start memory cache cleanup (when Redis is down)
     */
    startMemoryCacheCleanup() {
        console.log('[FALLBACK] Starting memory cache cleanup timer');
        
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
                status: this.redisConnected ? '✅ Healthy' : '⚠️ Fallback Mode',
                required: false,
                fallbackActive: !this.redisConnected
            },
            cache: {
                type: this.redisConnected ? 'Redis' : 'In-Memory Fallback',
                entries: this.redisConnected ? 'N/A' : this.memoryCache.size,
                status: '✅ Operational'
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
        }

        // Test Redis
        try {
            if (this.redis && this.redisConnected) {
                const pong = await this.redis.ping();
                results.redis = (pong === 'PONG');
                console.log('✅ Redis connection test passed');
            } else {
                console.log('⚠️ Redis connection test skipped (using fallback)');
            }
        } catch (error) {
            console.error('❌ Redis connection test failed:', error.message);
        }

        return results;
    }

    /**
     * Attempt to reconnect Redis
     */
    async reconnectRedis() {
        console.log('🔄 Attempting Redis reconnection...');
        
        try {
            if (this.redis) {
                await this.redis.disconnect();
            }
            
            await this.initializeRedis();
            
            if (this.redisConnected) {
                console.log('✅ Redis reconnection successful');
                return true;
            } else {
                console.log('⚠️ Redis reconnection failed, continuing with fallback');
                return false;
            }
        } catch (error) {
            console.error('❌ Redis reconnection error:', error);
            return false;
        }
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
