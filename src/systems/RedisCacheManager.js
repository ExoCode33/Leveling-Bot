/**
 * RedisCacheManager - High-level caching interface for Leveling-Bot
 * Handles all caching operations with automatic fallback to ConnectionManager
 */
class RedisCacheManager {
    constructor(redis = null, connectionManager = null) {
        this.redis = redis;
        this.connectionManager = connectionManager;
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
            const key = `avatar:${userId}:${avatarHash}`;
            const ttl = 43200; // 12 hours in seconds
            
            if (this.connectionManager) {
                return await this.connectionManager.setBinaryCache(key, avatarBuffer, ttl);
            }
            
            console.log(`[CACHE] Cached avatar for user ${userId} (${avatarHash})`);
            return true;
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
            const key = `avatar:${userId}:${avatarHash}`;
            
            if (this.connectionManager) {
                const buffer = await this.connectionManager.getBinaryCache(key);
                if (buffer) {
                    console.log(`[CACHE] Avatar cache hit for user ${userId}`);
                    return buffer;
                }
            }
            
            console.log(`[CACHE] Avatar cache miss for user ${userId}`);
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
            const key = `poster:${userId}:${level}:${bounty}`;
            const ttl = 86400; // 24 hours
            
            if (this.connectionManager) {
                return await this.connectionManager.setBinaryCache(key, canvasBuffer, ttl);
            }
            
            console.log(`[CACHE] Cached wanted poster for user ${userId} (Level ${level})`);
            return true;
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
            const key = `poster:${userId}:${level}:${bounty}`;
            
            if (this.connectionManager) {
                const buffer = await this.connectionManager.getBinaryCache(key);
                if (buffer) {
                    console.log(`[CACHE] Poster cache hit for user ${userId} (Level ${level})`);
                    return buffer;
                }
            }
            
            console.log(`[CACHE] Poster cache miss for user ${userId} (Level ${level})`);
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
            const pattern = `poster:${userId}:*`;
            
            if (this.connectionManager) {
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] Invalidated ${cleared} posters for user ${userId}`);
                return cleared > 0;
            }
            
            return true;
        } catch (error) {
            console.error('[CACHE] Error invalidating posters:', error);
            return false;
        }
    }

    // ==================== USER STATS CACHING ====================
    
    /**
     * Cache user stats (5 minute TTL, invalidate on XP changes)
     */
    async cacheUserStats(userId, guildId, stats) {
        try {
            const key = `stats:${guildId}:${userId}`;
            const ttl = 300; // 5 minutes
            
            if (this.connectionManager) {
                return await this.connectionManager.setCache(key, stats, ttl);
            }
            
            console.log(`[CACHE] Cached stats for user ${userId} in guild ${guildId}`);
            return true;
        } catch (error) {
            console.error('[CACHE] Error caching user stats:', error);
            return false;
        }
    }

    /**
     * Get cached user stats
     */
    async getCachedUserStats(userId, guildId) {
        try {
            const key = `stats:${guildId}:${userId}`;
            
            if (this.connectionManager) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    console.log(`[CACHE] Stats cache hit for user ${userId}`);
                    return data;
                }
            }
            
            console.log(`[CACHE] Stats cache miss for user ${userId}`);
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached stats:', error);
            return null;
        }
    }

    /**
     * Invalidate user stats cache (on XP changes)
     */
    async invalidateUserStats(userId, guildId) {
        try {
            const key = `stats:${guildId}:${userId}`;
            
            if (this.connectionManager) {
                await this.connectionManager.deleteCache(key);
            }
            
            console.log(`[CACHE] Invalidated stats for user ${userId}`);
            return true;
        } catch (error) {
            console.error('[CACHE] Error invalidating stats:', error);
            return false;
        }
    }

    // ==================== DAILY CAP PROGRESS CACHING ====================
    
    /**
     * Cache daily progress with tier awareness
     */
    async cacheDailyProgress(userId, guildId, date, tierRoleId, progress) {
        try {
            const key = `daily:${guildId}:${userId}:${date}:${tierRoleId || 'none'}`;
            const ttl = this.getSecondsUntilDailyReset();
            
            if (this.connectionManager) {
                return await this.connectionManager.setCache(key, progress, ttl);
            }
            
            console.log(`[CACHE] Cached daily progress for user ${userId} (Tier: ${tierRoleId || 'none'})`);
            return true;
        } catch (error) {
            console.error('[CACHE] Error caching daily progress:', error);
            return false;
        }
    }

    /**
     * Get cached daily progress
     */
    async getCachedDailyProgress(userId, guildId, date, tierRoleId) {
        try {
            const key = `daily:${guildId}:${userId}:${date}:${tierRoleId || 'none'}`;
            
            if (this.connectionManager) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    console.log(`[CACHE] Daily progress cache hit for user ${userId}`);
                    return data;
                }
            }
            
            console.log(`[CACHE] Daily progress cache miss for user ${userId}`);
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached daily progress:', error);
            return null;
        }
    }

    /**
     * Invalidate daily progress when tier role changes
     */
    async invalidateUserDailyProgress(userId, guildId, date) {
        try {
            const pattern = `daily:${guildId}:${userId}:${date}:*`;
            
            if (this.connectionManager) {
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] Invalidated daily progress for user ${userId} (tier role change)`);
                return cleared > 0;
            }
            
            return true;
        } catch (error) {
            console.error('[CACHE] Error invalidating daily progress:', error);
            return false;
        }
    }

    /**
     * Clear all daily progress caches (daily reset)
     */
    async clearAllDailyProgress(guildId, date) {
        try {
            const pattern = `daily:${guildId}:*:${date}:*`;
            
            if (this.connectionManager) {
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] Cleared ${cleared} daily progress caches for daily reset`);
                return cleared;
            }
            
            return 0;
        } catch (error) {
            console.error('[CACHE] Error clearing daily progress:', error);
            return 0;
        }
    }

    // ==================== LEADERBOARD CACHING ====================
    
    /**
     * Cache leaderboard (10 minute TTL)
     */
    async cacheLeaderboard(guildId, type, limit, leaderboardData) {
        try {
            const key = `leaderboard:${guildId}:${type}:${limit}`;
            const ttl = 600; // 10 minutes
            
            if (this.connectionManager) {
                return await this.connectionManager.setCache(key, leaderboardData, ttl);
            }
            
            console.log(`[CACHE] Cached leaderboard for guild ${guildId} (${type}, limit: ${limit})`);
            return true;
        } catch (error) {
            console.error('[CACHE] Error caching leaderboard:', error);
            return false;
        }
    }

    /**
     * Get cached leaderboard
     */
    async getCachedLeaderboard(guildId, type, limit) {
        try {
            const key = `leaderboard:${guildId}:${type}:${limit}`;
            
            if (this.connectionManager) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    console.log(`[CACHE] Leaderboard cache hit for guild ${guildId}`);
                    return data;
                }
            }
            
            console.log(`[CACHE] Leaderboard cache miss for guild ${guildId}`);
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached leaderboard:', error);
            return null;
        }
    }

    /**
     * Invalidate leaderboards when someone levels up
     */
    async invalidateGuildLeaderboards(guildId) {
        try {
            const pattern = `leaderboard:${guildId}:*`;
            
            if (this.connectionManager) {
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] Invalidated ${cleared} leaderboards for guild ${guildId}`);
                return cleared > 0;
            }
            
            return true;
        } catch (error) {
            console.error('[CACHE] Error invalidating leaderboards:', error);
            return false;
        }
    }

    // ==================== XP COOLDOWN MANAGEMENT ====================
    
    /**
     * Set XP cooldown (TTL-based, persistent across restarts)
     */
    async setXPCooldown(userId, guildId, source, cooldownMs) {
        try {
            const key = `cooldown:${guildId}:${userId}:${source}`;
            const ttl = Math.ceil(cooldownMs / 1000); // Convert to seconds
            
            if (this.connectionManager) {
                return await this.connectionManager.setCache(key, Date.now().toString(), ttl);
            }
            
            return true;
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
            const key = `cooldown:${guildId}:${userId}:${source}`;
            
            if (this.connectionManager) {
                const exists = await this.connectionManager.getCache(key);
                return exists !== null;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error checking XP cooldown:', error);
            return false; // Default to allowing XP if cache fails
        }
    }

    // ==================== UTILITY METHODS ====================
    
    /**
     * Calculate seconds until daily reset (for TTL)
     */
    getSecondsUntilDailyReset() {
        const now = new Date();
        const resetHour = parseInt(process.env.DAILY_RESET_HOUR_EDT) || 19;
        const resetMinute = parseInt(process.env.DAILY_RESET_MINUTE_EDT) || 35;
        
        // Simple calculation - can be enhanced with proper timezone handling
        const nextReset = new Date();
        nextReset.setHours(resetHour, resetMinute, 0, 0);
        
        if (nextReset.getTime() <= now.getTime()) {
            nextReset.setDate(nextReset.getDate() + 1);
        }
        
        return Math.ceil((nextReset.getTime() - now.getTime()) / 1000);
    }

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
            const info = await redis.info('memory');
            
            // Count keys by type using Lua script for efficiency
            const stats = {
                avatars: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:avatar:*'),
                posters: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:poster:*'),
                stats: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:stats:*'),
                daily: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:daily:*'),
                leaderboards: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:leaderboard:*'),
                cooldowns: await redis.eval(`return #redis.call('keys', KEYS[1])`, 1, 'Leveling-Bot:cooldown:*')
            };
            
            stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);
            stats.memory = info;
            stats.mode = 'Redis';
            stats.redis = true;
            
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
     * Flush all Leveling-Bot cache (maintenance)
     */
    async flushBotCache() {
        try {
            if (this.connectionManager) {
                const pattern = 'Leveling-Bot:*';
                const cleared = await this.connectionManager.clearPattern(pattern);
                console.log(`[CACHE] Flushed ${cleared} Leveling-Bot cache keys`);
                return cleared;
            }
            
            return 0;
        } catch (error) {
            console.error('[CACHE] Error flushing cache:', error);
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
            }
            return false;
        } catch (error) {
            console.error('[CACHE] Health check failed:', error);
            return false;
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
