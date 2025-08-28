/**
 * RedisCacheManager - High-level caching interface for Leveling-Bot
 * ENHANCED: Cache preloading system and advanced optimization
 */
class RedisCacheManager {
    constructor(redis = null, connectionManager = null) {
        this.redis = redis;
        this.connectionManager = connectionManager;
        this.keyPrefix = 'Leveling-Bot:';
        this.preloadingInProgress = false;
        this.preloadStats = {
            totalUsers: 0,
            avatarsPreloaded: 0,
            postersPreloaded: 0,
            errors: 0,
            startTime: null,
            endTime: null
        };
    }

    /**
     * Initialize cache manager with preloading
     */
    async initialize() {
        if (this.redis) {
            console.log('✅ Redis cache manager initialized');
        } else {
            console.log('⚠️ Cache manager initialized in fallback mode');
        }
        return true;
    }

    /**
     * PRELOAD SYSTEM - Warm up cache on bot startup
     */
    async preloadCache(client, databaseManager) {
        if (this.preloadingInProgress) {
            console.log('[PRELOAD] Cache preloading already in progress');
            return false;
        }

        if (!this.connectionManager?.isRedisAvailable()) {
            console.log('[PRELOAD] ⚠️ Redis not available, skipping cache preloading');
            return false;
        }

        this.preloadingInProgress = true;
        this.preloadStats.startTime = Date.now();
        this.preloadStats = { ...this.preloadStats, totalUsers: 0, avatarsPreloaded: 0, postersPreloaded: 0, errors: 0 };

        console.log('[PRELOAD] 🚀 Starting cache preloading system...');

        try {
            // Get all active guilds
            const guilds = client.guilds.cache;
            console.log(`[PRELOAD] Processing ${guilds.size} guilds for cache preloading`);

            for (const [guildId, guild] of guilds) {
                console.log(`[PRELOAD] === Processing guild: ${guild.name} ===`);
                
                try {
                    await this.preloadGuildCache(guild, databaseManager);
                } catch (guildError) {
                    console.error(`[PRELOAD] Error preloading guild ${guild.name}:`, guildError);
                    this.preloadStats.errors++;
                }

                // Small delay between guilds to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            this.preloadStats.endTime = Date.now();
            const duration = (this.preloadStats.endTime - this.preloadStats.startTime) / 1000;

            console.log('[PRELOAD] ✅ Cache preloading complete!');
            console.log(`[PRELOAD] 📊 Statistics:`);
            console.log(`[PRELOAD]   Duration: ${duration.toFixed(2)}s`);
            console.log(`[PRELOAD]   Total Users: ${this.preloadStats.totalUsers}`);
            console.log(`[PRELOAD]   Avatars Preloaded: ${this.preloadStats.avatarsPreloaded}`);
            console.log(`[PRELOAD]   Posters Preloaded: ${this.preloadStats.postersPreloaded}`);
            console.log(`[PRELOAD]   Errors: ${this.preloadStats.errors}`);
            console.log(`[PRELOAD]   Rate: ${Math.round(this.preloadStats.totalUsers / duration)} users/second`);

            return true;

        } catch (error) {
            console.error('[PRELOAD] ❌ Critical error in cache preloading:', error);
            return false;
        } finally {
            this.preloadingInProgress = false;
        }
    }

    /**
     * Preload cache for a specific guild
     */
    async preloadGuildCache(guild, databaseManager) {
        try {
            // Get top users from database (leaderboard users are most accessed)
            const topUsers = await databaseManager.getLeaderboard(guild.id, 50); // Top 50 users
            
            if (!topUsers || topUsers.length === 0) {
                console.log(`[PRELOAD] No users found for guild ${guild.name}`);
                return;
            }

            console.log(`[PRELOAD] Processing ${topUsers.length} top users in ${guild.name}`);

            // Process users in batches to avoid overwhelming Discord API
            const batchSize = 5;
            for (let i = 0; i < topUsers.length; i += batchSize) {
                const batch = topUsers.slice(i, i + batchSize);
                
                const batchPromises = batch.map(async (userData) => {
                    try {
                        await this.preloadUserCache(guild, userData);
                        this.preloadStats.totalUsers++;
                    } catch (userError) {
                        console.error(`[PRELOAD] Error preloading user ${userData.user_id}:`, userError);
                        this.preloadStats.errors++;
                    }
                });

                // Wait for batch to complete
                await Promise.all(batchPromises);

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 200));
            }

        } catch (error) {
            console.error(`[PRELOAD] Error in guild ${guild.name}:`, error);
            throw error;
        }
    }

    /**
     * Preload cache for a specific user
     */
    async preloadUserCache(guild, userData) {
        try {
            // Try to fetch member
            let member = null;
            try {
                member = guild.members.cache.get(userData.user_id);
                if (!member) {
                    member = await guild.members.fetch(userData.user_id);
                }
            } catch (error) {
                // User might have left the guild, skip
                return;
            }

            if (!member || member.user.bot) {
                return; // Skip bots and invalid members
            }

            // PRELOAD AVATAR
            await this.preloadUserAvatar(member.user);

            // PRELOAD WANTED POSTER
            await this.preloadUserPoster(userData, member, guild);

        } catch (error) {
            // Don't log individual user errors to avoid spam
            throw error;
        }
    }

    /**
     * Preload user avatar
     */
    async preloadUserAvatar(user) {
        try {
            const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
            const avatarHash = this.extractAvatarHash(avatarURL);
            
            if (!avatarHash) {
                console.log(`[PRELOAD] ⚠️ No avatar hash for ${user.username}, skipping`);
                return;
            }

            // Check if already cached
            const existing = await this.getCachedAvatar(user.id, avatarHash);
            if (existing) {
                console.log(`[PRELOAD] 📋 Avatar already cached for ${user.username}`);
                return; // Already cached
            }

            // Load and cache avatar
            console.log(`[PRELOAD] 📥 Loading avatar for ${user.username}...`);
            const { loadImage, createCanvas } = require('canvas');
            const avatar = await loadImage(avatarURL);
            
            // Convert to buffer
            const tempCanvas = createCanvas(512, 512);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(avatar, 0, 0, 512, 512);
            const buffer = tempCanvas.toBuffer();
            
            // Cache the avatar
            const cacheSuccess = await this.cacheUserAvatar(user.id, avatarHash, buffer);
            if (cacheSuccess) {
                this.preloadStats.avatarsPreloaded++;
                console.log(`[PRELOAD] ✅ Successfully cached avatar for ${user.username} (${Math.round(buffer.length/1024)}KB)`);
            } else {
                console.log(`[PRELOAD] ❌ Failed to cache avatar for ${user.username}`);
            }

        } catch (error) {
            console.error(`[PRELOAD] ❌ Error preloading avatar for ${user.username}:`, error);
            this.preloadStats.errors++;
        }
    }

    /**
     * Preload user wanted poster
     */
    async preloadUserPoster(userData, member, guild) {
        try {
            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalculator = new BountyCalculator();
            const bounty = bountyCalculator.getBountyForLevel(userData.level);

            // Check if poster already cached
            const existing = await this.getCachedPoster(userData.user_id, userData.level, bounty);
            if (existing) {
                console.log(`[PRELOAD] 📋 Poster already cached for ${member.displayName} (Level ${userData.level})`);
                return; // Already cached
            }

            console.log(`[PRELOAD] 🎨 Generating poster for ${member.displayName} (Level ${userData.level})...`);

            // Generate poster
            const CanvasGenerator = require('../utils/CanvasGenerator');
            const canvasGenerator = new CanvasGenerator(this);
            
            const fullUserData = {
                ...userData,
                member: member,
                userId: userData.user_id,
                bounty: bounty,
                isPirateKing: false
            };

            const canvas = await canvasGenerator.createWantedPoster(fullUserData, guild);
            const buffer = canvas.toBuffer();
            
            // Cache the poster - this will be done automatically by CanvasGenerator
            const cacheSuccess = await this.cacheWantedPoster(userData.user_id, userData.level, bounty, buffer);
            if (cacheSuccess) {
                this.preloadStats.postersPreloaded++;
                console.log(`[PRELOAD] ✅ Successfully cached poster for ${member.displayName} (Level ${userData.level}, ${Math.round(buffer.length/1024)}KB)`);
            } else {
                console.log(`[PRELOAD] ❌ Failed to cache poster for ${member.displayName}`);
            }

        } catch (error) {
            console.error(`[PRELOAD] ❌ Error preloading poster for ${member.displayName}:`, error);
            this.preloadStats.errors++;
        }
    }

    /**
     * Extract avatar hash from Discord avatar URL
     */
    extractAvatarHash(avatarURL) {
        try {
            const match = avatarURL.match(/avatars\/\d+\/([a-f0-9]+)\.(png|jpg|gif|webp)/);
            return match ? match[1] : null;
        } catch (error) {
            return null;
        }
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
                if (result) {
                    console.log(`[CACHE] ✅ Cached avatar for user ${userId} (${Math.round(avatarBuffer.length/1024)}KB)`);
                }
                return result;
            } else if (this.redis) {
                // Direct Redis fallback
                await this.redis.setex(key, ttl, avatarBuffer);
                console.log(`[CACHE] ✅ Direct Redis: Cached avatar for user ${userId}`);
                return true;
            }
            
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
                    return buffer;
                }
            } else if (this.redis) {
                // Direct Redis fallback
                const buffer = await this.redis.getBuffer(key);
                if (buffer) {
                    return buffer;
                }
            }
            
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
                if (result) {
                    console.log(`[CACHE] ✅ Cached wanted poster for user ${userId} (Level ${level}, ${Math.round(canvasBuffer.length/1024)}KB)`);
                }
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
                    return buffer;
                }
            } else if (this.redis) {
                const buffer = await this.redis.getBuffer(key);
                if (buffer) {
                    return buffer;
                }
            }
            
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
                return cleared > 0;
            } else if (this.redis) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
                return keys.length > 0;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error invalidating posters:', error);
            return false;
        }
    }

    // ==================== LEADERBOARD CACHING ====================
    
    /**
     * Cache leaderboard data (5 minute TTL for fast updates)
     */
    async cacheLeaderboard(guildId, type, data) {
        try {
            const key = `${this.keyPrefix}leaderboard:${guildId}:${type}`;
            const ttl = 300; // 5 minutes
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                return await this.connectionManager.setCache(key, JSON.stringify(data), ttl);
            } else if (this.redis) {
                await this.redis.setex(key, ttl, JSON.stringify(data));
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error caching leaderboard:', error);
            return false;
        }
    }

    /**
     * Get cached leaderboard data
     */
    async getCachedLeaderboard(guildId, type) {
        try {
            const key = `${this.keyPrefix}leaderboard:${guildId}:${type}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    return JSON.parse(data);
                }
            } else if (this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    return JSON.parse(data);
                }
            }
            
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached leaderboard:', error);
            return null;
        }
    }

    /**
     * Cache validated users list (10 minute TTL)
     */
    async cacheValidatedUsers(guildId, users) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            const ttl = 600; // 10 minutes
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                return await this.connectionManager.setCache(key, JSON.stringify(users), ttl);
            } else if (this.redis) {
                await this.redis.setex(key, ttl, JSON.stringify(users));
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error caching validated users:', error);
            return false;
        }
    }

    /**
     * Get cached validated users
     */
    async getCachedValidatedUsers(guildId) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    return JSON.parse(data);
                }
            } else if (this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    return JSON.parse(data);
                }
            }
            
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached validated users:', error);
            return null;
        }
    }

    /**
     * Invalidate guild cache when users leave
     */
    async invalidateGuildCache(guildId) {
        try {
            const patterns = [
                `${this.keyPrefix}leaderboard:${guildId}:*`,
                `${this.keyPrefix}validated:${guildId}`
            ];

            let totalCleared = 0;
            for (const pattern of patterns) {
                if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                    const cleared = await this.connectionManager.clearPattern(pattern);
                    totalCleared += cleared;
                } else if (this.redis) {
                    const keys = await this.redis.keys(pattern);
                    if (keys.length > 0) {
                        await this.redis.del(...keys);
                        totalCleared += keys.length;
                    }
                }
            }

            if (totalCleared > 0) {
                console.log(`[CACHE] Invalidated ${totalCleared} guild cache entries for ${guildId}`);
            }

            return totalCleared > 0;
        } catch (error) {
            console.error('[CACHE] Error invalidating guild cache:', error);
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

    // ==================== DAILY PROGRESS CACHING ====================

    /**
     * Invalidate user's daily progress cache
     */
    async invalidateUserDailyProgress(userId, guildId, date) {
        try {
            const key = `${this.keyPrefix}daily:${guildId}:${userId}:${date}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                await this.connectionManager.deleteCache(key);
            } else if (this.redis) {
                await this.redis.del(key);
            }
            
            return true;
        } catch (error) {
            console.error('[CACHE] Error invalidating daily progress:', error);
            return false;
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
     * Get preload statistics
     */
    getPreloadStats() {
        return { ...this.preloadStats };
    }

    /**
     * Check if preloading is in progress
     */
    isPreloading() {
        return this.preloadingInProgress;
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
                cooldowns: await this.countKeys(`${this.keyPrefix}cooldown:*`),
                leaderboards: await this.countKeys(`${this.keyPrefix}leaderboard:*`),
                validated: await this.countKeys(`${this.keyPrefix}validated:*`)
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
     * Count keys matching pattern - IMPROVED WITH ACTUAL REDIS SCAN
     */
    async countKeys(pattern) {
        try {
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const redis = this.connectionManager.getRedis();
                const keys = await redis.keys(pattern);
                return keys.length;
            } else if (this.redis) {
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
