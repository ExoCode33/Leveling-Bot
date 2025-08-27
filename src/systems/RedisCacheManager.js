/**
 * RedisCacheManager - High-level caching interface for Leveling-Bot
 * FIXED: Proper Redis key prefixing and cache integration
 */
class RedisCacheManager {
    constructor(redis = null, connectionManager = null) {
        this.redis = redis;
        this.connectionManager = connectionManager;
        this.keyPrefix = 'Leveling-Bot:';
    }

    /**
     * Initialize cache manager
     */
    async initialize() {
        if (this.redis) {
            console.log('✅ Redis cache manager initialized');
        } else {
            console.log('⚠️ Cache manager initialized in fallback mode');
        }
        return true;
    }

    // ==================== USER AVATAR CACHING ====================
    
    /**
     * Cache user avatar (12 hour TTL)
     */
    async cacheUserAvatar(userId, avatarHash, avatarBuffer) {
        try {
            const key = `${this.keyPrefix}avatar:${userId}:${avatarHash}`;
            const ttl = 43200; // 12 hours in seconds
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const result = await this.connectionManager.setBinaryCache(key, avatarBuffer, ttl);
                console.log(`[CACHE] ✅ Cached avatar for user ${userId} (${Math.round(avatarBuffer.length/1024)}KB)`);
                return result;
            } else if (this.redis) {
                // Direct Redis fallback
                await this.redis.setex(key, ttl, avatarBuffer);
                console.log(`[CACHE] ✅ Direct Redis: Cached avatar for user ${userId}`);
                return true;
            }
            
            console.log(`[CACHE] ❌ No cache available for avatar ${userId}`);
            return false;
        } catch (error) {
            console.error('[CACHE] Error caching avatar:', error);
            return false;
        }
    }

    /**
     * Get cached user avatar
     */
    async getCachedAvatar(userId, avatarHash) {
        try {
            const key = `${this.keyPrefix}avatar:${userId}:${avatarHash}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const buffer = await this.connectionManager.getBinaryCache(key);
                if (buffer) {
                    console.log(`[CACHE] ✅ Avatar cache HIT for user ${userId}`);
                    return buffer;
                }
            } else if (this.redis) {
                // Direct Redis fallback
                const buffer = await this.redis.getBuffer(key);
                if (buffer) {
                    console.log(`[CACHE] ✅ Direct Redis: Avatar cache HIT for user ${userId}`);
                    return buffer;
                }
            }
            
            console.log(`[CACHE] ❌ Avatar cache MISS for user ${userId}`);
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached avatar:', error);
            return null;
        }
    }

    // ==================== WANTED POSTER CACHING ====================
    
    /**
     * Cache generated wanted poster (24 hour TTL)
     */
    async cacheWantedPoster(userId, level, bounty, canvasBuffer) {
        try {
            const key = `${this.keyPrefix}poster:${userId}:${level}:${bounty}`;
            const ttl = 86400; // 24 hours
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const result = await this.connectionManager.setBinaryCache(key, canvasBuffer, ttl);
                console.log(`[CACHE] ✅ Cached wanted poster for user ${userId} (Level ${level}, ${Math.round(canvasBuffer.length/1024)}KB)`);
                return result;
            } else if (this.redis) {
                await this.redis.setex(key, ttl, canvasBuffer);
                console.log(`[CACHE] ✅ Direct Redis: Cached wanted poster for user ${userId}`);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error caching poster:', error);
            return false;
        }
    }

    /**
     * Get cached wanted poster
     */
    async getCachedPoster(userId, level, bounty) {
        try {
            const key = `${this.keyPrefix}poster:${userId}:${level}:${bounty}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const buffer = await this.connectionManager.getBinaryCache(key);
                if (buffer) {
                    console.log(`[CACHE] ✅ Poster cache HIT for user ${userId} (Level ${level})`);
                    return buffer;
                }
            } else if (this.redis) {
                const buffer = await this.redis.getBuffer(key);
                if (buffer) {
                    console.log(`[CACHE] ✅ Direct Redis: Poster cache HIT for user ${userId}`);
                    return buffer;
                }
            }
            
            console.log(`[CACHE] ❌ Poster cache MISS for user ${userId} (Level ${level})`);
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached poster:', error);
            return null;
        }
    }

    /**
     * Invalidate user's poster cache when level changes
     */
    async invalidateUserPosters(userId) {
        try {
            const pattern = `${this.keyPrefix}poster:${userId}:*`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] ✅ Invalidated ${cleared} posters for user ${userId}`);
                return cleared > 0;
            } else if (this.redis) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                    console.log(`[CACHE] ✅ Direct Redis: Invalidated ${keys.length} posters for user ${userId}`);
                }
                return keys.length > 0;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error invalidating posters:', error);
            return false;
        }
    }

    // ==================== XP COOLDOWN MANAGEMENT ====================
    
    /**
     * Set XP cooldown (TTL-based, persistent across restarts)
     */
    async setXPCooldown(userId, guildId, source, cooldownMs) {
        try {
            const key = `${this.keyPrefix}cooldown:${guildId}:${userId}:${source}`;
            const ttl = Math.ceil(cooldownMs / 1000); // Convert to seconds
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                return await this.connectionManager.setCache(key, Date.now().toString(), ttl);
            } else if (this.redis) {
                await this.redis.setex(key, ttl, Date.now().toString());
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error setting XP cooldown:', error);
            return false;
        }
    }

    /**
     * Check if user is on XP cooldown
     */
    async isOnXPCooldown(userId, guildId, source) {
        try {
            const key = `${this.keyPrefix}cooldown:${guildId}:${userId}:${source}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const exists = await this.connectionManager.getCache(key);
                return exists !== null;
            } else if (this.redis) {
                const exists = await this.redis.exists(key);
                return exists === 1;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error checking XP cooldown:', error);
            return false; // Default to allowing XP if cache fails
        }
    }

    // ==================== UTILITY METHODS ====================
    
    /**
     * Get current date string for cache keys
     */
    getCurrentDateKey() {
        return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    }

    /**
     * Get cache statistics
     */
    async getCacheStats() {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                return {
                    mode: 'In-Memory Fallback',
                    entries: this.connectionManager ? this.connectionManager.memoryCache.size : 0,
                    redis: false
                };
            }

            const redis = this.connectionManager.getRedis();
            
            // Count keys by type using SCAN for better performance
            const stats = {
                avatars: await this.countKeys(`${this.keyPrefix}avatar:*`),
                posters: await this.countKeys(`${this.keyPrefix}poster:*`),
                cooldowns: await this.countKeys(`${this.keyPrefix}cooldown:*`)
            };
            
            stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);
            stats.mode = 'Redis';
            stats.redis = true;
            
            // Get Redis memory info if available
            try {
                const info = await redis.info('memory');
                const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown';
                stats.memoryUsed = usedMemory;
            } catch (error) {
                console.log('[CACHE] Could not get Redis memory info');
            }
            
            return stats;
        } catch (error) {
            console.error('[CACHE] Error getting cache stats:', error);
            return {
                mode: 'Error',
                entries: 0,
                redis: false,
                error: error.message
            };
        }
    }

    /**
     * Count keys matching pattern
     */
    async countKeys(pattern) {
        try {
            if (this.redis) {
                const keys = await this.redis.keys(pattern);
                return keys.length;
            }
            return 0;
        } catch (error) {
            console.error(`[CACHE] Error counting keys for pattern ${pattern}:`, error);
            return 0;
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        try {
            if (this.connectionManager) {
                return this.connectionManager.isRedisAvailable();
            } else if (this.redis) {
                const result = await this.redis.ping();
                return result === 'PONG';
            }
            return false;
        } catch (error) {
            console.error('[CACHE] Health check failed:', error);
            return false;
        }
    }

    /**
     * Test cache functionality
     */
    async testCache() {
        try {
            const testKey = `${this.keyPrefix}test:${Date.now()}`;
            const testValue = 'cache-test-value';
            
            // Test set
            let setResult = false;
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                setResult = await this.connectionManager.setCache(testKey, testValue, 60);
            } else if (this.redis) {
                await this.redis.setex(testKey, 60, testValue);
                setResult = true;
            }
            
            if (!setResult) {
                return { success: false, error: 'Cache set failed' };
            }
            
            // Test get
            let getValue = null;
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                getValue = await this.connectionManager.getCache(testKey);
            } else if (this.redis) {
                getValue = await this.redis.get(testKey);
            }
            
            // Clean up
            try {
                if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                    await this.connectionManager.deleteCache(testKey);
                } else if (this.redis) {
                    await this.redis.del(testKey);
                }
            } catch (cleanupError) {
                console.log('[CACHE] Cleanup error (not critical):', cleanupError.message);
            }
            
            if (getValue === testValue) {
                return { success: true, message: 'Cache test passed' };
            } else {
                return { success: false, error: `Cache test failed: expected '${testValue}', got '${getValue}'` };
            }
            
        } catch (error) {
            console.error('[CACHE] Cache test error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Graceful cleanup
     */
    async cleanup() {
        try {
            console.log('[CACHE] Cache manager cleanup complete');
        } catch (error) {
            console.error('[CACHE] Error during cleanup:', error);
        }
    }
}

module.exports = RedisCacheManager;
