/**
 * RedisCacheManager - High-level caching interface for Leveling-Bot
 * FIXED: Syntax error with try-catch blocks and cache preloading system
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
     * Initialize cache manager
     */
    async initialize() {
        if (this.redis || (this.connectionManager && this.connectionManager.isRedisAvailable())) {
            console.log('✅ Redis cache manager initialized');
        } else {
            console.log('⚠️ Cache manager initialized in fallback mode');
        }
        return true;
    }

    /**
     * PRELOAD SYSTEM - Warm up cache on bot startup - FIXED VERSION
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
        this.preloadStats = { 
            ...this.preloadStats, 
            totalUsers: 0, 
            avatarsPreloaded: 0, 
            postersPreloaded: 0, 
            errors: 0 
        };

        console.log('[PRELOAD] 🚀 Starting ENHANCED cache preloading system...');

        try {
            const guilds = client.guilds.cache;
            console.log(`[PRELOAD] Processing ${guilds.size} guilds for cache preloading`);

            for (const [guildId, guild] of guilds) {
                console.log(`[PRELOAD] ⭐ === Processing guild: ${guild.name} ===`);
                
                try {
                    await this.preloadGuildCache(guild, databaseManager);
                } catch (guildError) {
                    console.error(`[PRELOAD] ❌ Error preloading guild ${guild.name}:`, guildError);
                    this.preloadStats.errors++;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const processedGuilds = Array.from(guilds.keys()).indexOf(guildId) + 1;
                if (processedGuilds % 5 === 0 || processedGuilds === guilds.size) {
                    console.log(`[PRELOAD] 📊 Progress: ${processedGuilds}/${guilds.size} guilds, ${this.preloadStats.totalUsers} users, ${this.preloadStats.avatarsPreloaded + this.preloadStats.postersPreloaded} items cached`);
                }
            }

            this.preloadStats.endTime = Date.now();
            const duration = (this.preloadStats.endTime - this.preloadStats.startTime) / 1000;

            console.log('[PRELOAD] ✅ ENHANCED cache preloading complete!');
            console.log(`[PRELOAD] 📊 Final Statistics:`);
            console.log(`[PRELOAD]   Duration: ${duration.toFixed(2)}s`);
            console.log(`[PRELOAD]   Total Users: ${this.preloadStats.totalUsers}`);
            console.log(`[PRELOAD]   Avatars: ${this.preloadStats.avatarsPreloaded}`);
            console.log(`[PRELOAD]   Posters: ${this.preloadStats.postersPreloaded}`);
            console.log(`[PRELOAD]   Total Items: ${this.preloadStats.avatarsPreloaded + this.preloadStats.postersPreloaded}`);
            console.log(`[PRELOAD]   Errors: ${this.preloadStats.errors}`);

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
            console.log(`[PRELOAD] 🏴‍☠️ Processing guild: ${guild.name} (ID: ${guild.id})`);
            
            const topUsers = await databaseManager.getLeaderboard(guild.id, 50);
            
            if (!topUsers || topUsers.length === 0) {
                console.log(`[PRELOAD] ⚠️ No users found in database for guild ${guild.name}`);
                return;
            }

            console.log(`[PRELOAD] 📊 Found ${topUsers.length} database users in ${guild.name}`);

            const batchSize = 3;
            let processedUsers = 0;
            
            for (let i = 0; i < topUsers.length; i += batchSize) {
                const batch = topUsers.slice(i, i + batchSize);
                
                console.log(`[PRELOAD] 📦 Guild ${guild.name} - Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(topUsers.length/batchSize)}`);
                
                const batchResults = await Promise.allSettled(
                    batch.map(async (userData) => {
                        try {
                            this.preloadStats.totalUsers++;
                            processedUsers++;
                            await this.preloadUserCache(guild, userData);
                            return { success: true, userId: userData.user_id };
                        } catch (userError) {
                            console.error(`[PRELOAD] ❌ Error preloading user ${userData.user_id}:`, userError);
                            this.preloadStats.errors++;
                            return { success: false, userId: userData.user_id };
                        }
                    })
                );
                
                const successful = batchResults.filter(r => r.value?.success).length;
                console.log(`[PRELOAD] 📋 Batch result: ${successful}/${batch.length} successful`);

                if (i + batchSize < topUsers.length) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }

            console.log(`[PRELOAD] ✅ Guild ${guild.name} complete: ${processedUsers} users processed`);

        } catch (error) {
            console.error(`[PRELOAD] ❌ Critical error in guild ${guild.name}:`, error);
            throw error;
        }
    }

    /**
     * Preload user cache
     */
    async preloadUserCache(guild, userData) {
        try {
            let member = null;
            try {
                member = guild.members.cache.get(userData.user_id);
                if (!member) {
                    member = await guild.members.fetch(userData.user_id);
                }
            } catch (error) {
                return;
            }

            if (!member || member.user.bot) {
                return;
            }

            console.log(`[PRELOAD] 🔍 Processing ${member.user.username} (Level ${userData.level})`);

            // PRELOAD AVATAR
            const avatarResult = await this.preloadUserAvatar(member.user);
            if (avatarResult.success) {
                this.preloadStats.avatarsPreloaded++;
                console.log(`[PRELOAD] ✅ Avatar cached: ${member.user.username}`);
            } else {
                console.log(`[PRELOAD] ⚠️ Avatar failed: ${member.user.username} - ${avatarResult.error}`);
            }

            // PRELOAD POSTER
            const posterResult = await this.preloadUserPoster(userData, member, guild);
            if (posterResult.success) {
                this.preloadStats.postersPreloaded++;
                console.log(`[PRELOAD] ✅ Poster cached: ${member.user.username}`);
            } else {
                console.log(`[PRELOAD] ⚠️ Poster failed: ${member.user.username} - ${posterResult.error}`);
            }

        } catch (error) {
            console.error(`[PRELOAD] ❌ Error preloading user ${userData.user_id}:`, error);
            this.preloadStats.errors++;
        }
    }

    /**
     * FIXED: Preload user avatar - Actually loads and caches with verification
     */
    async preloadUserAvatar(user) {
        try {
            console.log(`[PRELOAD] 🖼️ Processing avatar for ${user.username}...`);
            
            const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
            const avatarHash = this.extractAvatarHash(avatarURL);
            
            if (!avatarHash) {
                console.log(`[PRELOAD] ⚠️ No avatar hash for ${user.username}, using default`);
                return await this.preloadDefaultAvatar(user);
            }

            console.log(`[PRELOAD] 📥 Loading avatar for ${user.username} from ${avatarURL}`);
            
            const { loadImage, createCanvas } = require('canvas');
            
            try {
                const avatar = await Promise.race([
                    loadImage(avatarURL),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Avatar load timeout')), 8000))
                ]);
                
                const tempCanvas = createCanvas(512, 512);
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(avatar, 0, 0, 512, 512);
                const buffer = tempCanvas.toBuffer();
                
                const cacheSuccess = await this.cacheUserAvatar(user.id, avatarHash, buffer);
                
                if (cacheSuccess) {
                    return { success: true, cached: true, size: buffer.length };
                } else {
                    return { success: false, error: 'Cache write failed' };
                }
                
            } catch (loadError) {
                console.log(`[PRELOAD] ⚠️ PNG failed for ${user.username}, trying JPG...`);
                
                try {
                    const jpgURL = user.displayAvatarURL({ extension: 'jpg', size: 512, forceStatic: true });
                    const avatar = await Promise.race([
                        loadImage(jpgURL),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('JPG timeout')), 8000))
                    ]);
                    
                    const tempCanvas = createCanvas(512, 512);
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(avatar, 0, 0, 512, 512);
                    const buffer = tempCanvas.toBuffer();
                    
                    const cacheSuccess = await this.cacheUserAvatar(user.id, avatarHash, buffer);
                    
                    if (cacheSuccess) {
                        return { success: true, cached: true, size: buffer.length };
                    }
                } catch (jpgError) {
                    console.log(`[PRELOAD] ⚠️ JPG failed for ${user.username}, trying default`);
                    return await this.preloadDefaultAvatar(user);
                }
            }

            return { success: false, error: 'All avatar formats failed' };

        } catch (error) {
            console.error(`[PRELOAD] ❌ Critical error preloading avatar for ${user.username}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Preload default Discord avatar
     */
    async preloadDefaultAvatar(user) {
        try {
            console.log(`[PRELOAD] 🎭 Loading default avatar for ${user.username}...`);
            
            const { loadImage, createCanvas } = require('canvas');
            const defaultAvatarURL = `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
            
            const avatar = await Promise.race([
                loadImage(defaultAvatarURL),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Default avatar timeout')), 5000))
            ]);
            
            const tempCanvas = createCanvas(512, 512);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(avatar, 0, 0, 512, 512);
            const buffer = tempCanvas.toBuffer();
            
            const defaultHash = `default_${user.discriminator % 5}`;
            const cacheSuccess = await this.cacheUserAvatar(user.id, defaultHash, buffer);
            
            if (cacheSuccess) {
                return { success: true, cached: true, size: buffer.length, isDefault: true };
            }
            
            return { success: false, error: 'Default avatar cache failed' };
        } catch (error) {
            console.log(`[PRELOAD] ❌ Failed to load default avatar for ${user.username}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * FIXED: Preload user poster - Actually generates and caches with verification
     */
    async preloadUserPoster(userData, member, guild) {
        try {
            console.log(`[PRELOAD] 🎨 Processing poster for ${member.displayName} (Level ${userData.level})`);
            
            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalculator = new BountyCalculator();
            const bounty = bountyCalculator.getBountyForLevel(userData.level);

            const CanvasGenerator = require('../utils/CanvasGenerator');
            const canvasGenerator = new CanvasGenerator(this);
            
            const fullUserData = {
                ...userData,
                member: member,
                userId: userData.user_id,
                bounty: bounty,
                isPirateKing: false
            };

            try {
                const canvas = await canvasGenerator.createWantedPoster(fullUserData, guild);
                const buffer = canvas.toBuffer();
                
                const cacheSuccess = await this.cacheWantedPoster(userData.user_id, userData.level, bounty, buffer);
                
                if (cacheSuccess) {
                    return { success: true, cached: true, size: buffer.length };
                } else {
                    return { success: false, error: 'Poster cache write failed' };
                }
                
            } catch (canvasError) {
                console.error(`[PRELOAD] ❌ Canvas generation failed for ${member.displayName}:`, canvasError);
                return { success: false, error: canvasError.message };
            }

        } catch (error) {
            console.error(`[PRELOAD] ❌ Critical error preloading poster for ${member?.displayName}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract avatar hash from Discord avatar URL
     */
    extractAvatarHash(avatarURL) {
        try {
            const patterns = [
                /avatars\/(\d+)\/([a-f0-9]+)\.(png|jpg|gif|webp)/i,
                /\/([a-f0-9]{32})\.(png|jpg|gif|webp)/i,
                /embed\/avatars\/(\d+)\.png/i
            ];
            
            for (const pattern of patterns) {
                const match = avatarURL.match(pattern);
                if (match) {
                    if (pattern.source.includes('embed')) {
                        return `default_${match[1]}`;
                    } else {
                        return match[2] || match[1];
                    }
                }
            }
            
            console.log(`[CACHE] ⚠️ Could not extract avatar hash from: ${avatarURL}`);
            return null;
        } catch (error) {
            console.log(`[CACHE] ❌ Error extracting avatar hash: ${error.message}`);
            return null;
        }
    }

    // ==================== USER AVATAR CACHING ====================
    
    /**
     * FIXED: Cache user avatar with verification
     */
    async cacheUserAvatar(userId, avatarHash, avatarBuffer) {
        try {
            if (!avatarBuffer || !Buffer.isBuffer(avatarBuffer)) {
                console.error(`[CACHE] Invalid avatar buffer for user ${userId}`);
                return false;
            }

            const key = `${this.keyPrefix}avatar:${userId}:${avatarHash}`;
            const ttl = 43200; // 12 hours
            
            console.log(`[CACHE] Caching avatar: ${key} (${Math.round(avatarBuffer.length/1024)}KB)`);
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const result = await this.connectionManager.setBinaryCache(key, avatarBuffer, ttl);
                
                if (result) {
                    // Verify storage
                    const verification = await this.connectionManager.getBinaryCache(key);
                    if (verification && verification.length === avatarBuffer.length) {
                        console.log(`[CACHE] ✅ Avatar cached and verified for user ${userId}`);
                        return true;
                    } else {
                        console.error(`[CACHE] ❌ Avatar verification failed for user ${userId}`);
                        return false;
                    }
                }
                return false;
            } else if (this.redis) {
                await this.redis.setex(key, ttl, avatarBuffer);
                
                const verification = await this.redis.getBuffer(key);
                if (verification && verification.length === avatarBuffer.length) {
                    console.log(`[CACHE] ✅ Direct Redis: Avatar cached for user ${userId}`);
                    return true;
                } else {
                    console.error(`[CACHE] ❌ Direct Redis: Avatar verification failed for user ${userId}`);
                    return false;
                }
            }
            
            return false;
        } catch (error) {
            console.error(`[CACHE] ❌ Error caching avatar for user ${userId}:`, error);
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
                return await this.connectionManager.getBinaryCache(key);
            } else if (this.redis) {
                return await this.redis.getBuffer(key);
            }
            
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached avatar:', error);
            return null;
        }
    }

    // ==================== WANTED POSTER CACHING ====================
    
    /**
     * FIXED: Cache poster with verification
     */
    async cacheWantedPoster(userId, level, bounty, canvasBuffer) {
        try {
            if (!canvasBuffer || !Buffer.isBuffer(canvasBuffer)) {
                console.error(`[CACHE] Invalid poster buffer for user ${userId}`);
                return false;
            }

            const key = `${this.keyPrefix}poster:${userId}:${level}:${bounty}`;
            const ttl = 86400; // 24 hours
            
            console.log(`[CACHE] Caching poster: ${key} (${Math.round(canvasBuffer.length/1024)}KB)`);
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const result = await this.connectionManager.setBinaryCache(key, canvasBuffer, ttl);
                
                if (result) {
                    // Verify storage
                    const verification = await this.connectionManager.getBinaryCache(key);
                    if (verification && verification.length === canvasBuffer.length) {
                        console.log(`[CACHE] ✅ Poster cached and verified for user ${userId} (Level ${level})`);
                        return true;
                    } else {
                        console.error(`[CACHE] ❌ Poster verification failed for user ${userId}`);
                        return false;
                    }
                }
                return false;
            } else if (this.redis) {
                await this.redis.setex(key, ttl, canvasBuffer);
                
                const verification = await this.redis.getBuffer(key);
                if (verification && verification.length === canvasBuffer.length) {
                    console.log(`[CACHE] ✅ Direct Redis: Poster cached for user ${userId}`);
                    return true;
                } else {
                    console.error(`[CACHE] ❌ Direct Redis: Poster verification failed for user ${userId}`);
                    return false;
                }
            }
            
            return false;
        } catch (error) {
            console.error(`[CACHE] ❌ Error caching poster for user ${userId}:`, error);
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
                return await this.connectionManager.getBinaryCache(key);
            } else if (this.redis) {
                return await this.redis.getBuffer(key);
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
                return await this.connectionManager.clearPattern(pattern) > 0;
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
    
    async cacheLeaderboard(guildId, type, data) {
        try {
            const key = `${this.keyPrefix}leaderboard:${guildId}:${type}`;
            const ttl = 300;
            
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

    async cacheValidatedUsers(guildId, users) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            const ttl = 600;
            
            const cacheData = {
                users: users,
                cachedAt: Date.now(),
                version: this.generateCacheVersion(),
                guildId: guildId
            };
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                return await this.connectionManager.setCache(key, JSON.stringify(cacheData), ttl);
            } else if (this.redis) {
                await this.redis.setex(key, ttl, JSON.stringify(cacheData));
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[CACHE] Error caching validated users:', error);
            return false;
        }
    }

    async getCachedValidatedUsers(guildId) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    const cacheData = JSON.parse(data);
                    const cacheAge = Date.now() - cacheData.cachedAt;
                    if (cacheAge > 480000) {
                        console.log(`[CACHE] Validated users cache too old (${Math.round(cacheAge/1000)}s), ignoring`);
                        return null;
                    }
                    return cacheData.users;
                }
            } else if (this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    const cacheData = JSON.parse(data);
                    const cacheAge = Date.now() - cacheData.cachedAt;
                    if (cacheAge > 480000) {
                        console.log(`[CACHE] Validated users cache too old (${Math.round(cacheAge/1000)}s), ignoring`);
                        return null;
                    }
                    return cacheData.users;
                }
            }
            
            return null;
        } catch (error) {
            console.error('[CACHE] Error getting cached validated users:', error);
            return null;
        }
    }

    async safeWriteValidatedUsers(guildId, users) {
        try {
            const existingData = await this.getCachedValidatedUsers(guildId);
            
            if (existingData) {
                console.log('[CACHE] Recent cache exists, skipping write to prevent race condition');
                return false;
            }
            
            const invalidationFlag = `${this.keyPrefix}invalidated:${guildId}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const wasInvalidated = await this.connectionManager.getCache(invalidationFlag);
                if (wasInvalidated) {
                    const invalidatedAt = parseInt(wasInvalidated);
                    const timeSinceInvalidation = Date.now() - invalidatedAt;
                    
                    if (timeSinceInvalidation < 30000) {
                        console.log(`[CACHE] Cache was recently invalidated (${Math.round(timeSinceInvalidation/1000)}s ago), skipping write`);
                        return false;
                    }
                }
            }
            
            return await this.cacheValidatedUsers(guildId, users);
            
        } catch (error) {
            console.error('[CACHE] Error in safe cache write:', error);
            return false;
        }
    }

    async invalidateGuildCache(guildId) {
        try {
            const patterns = [
                `${this.keyPrefix}leaderboard:${guildId}:*`,
                `${this.keyPrefix}validated:${guildId}`
            ];

            const invalidationFlag = `${this.keyPrefix}invalidated:${guildId}`;
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                await this.connectionManager.setCache(invalidationFlag, Date.now().toString(), 60);
            }

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
    
    async setXPCooldown(userId, guildId, source, cooldownMs) {
        try {
            const key = `${this.keyPrefix}cooldown:${guildId}:${userId}:${source}`;
            const ttl = Math.ceil(cooldownMs / 1000);
            
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
            return false;
        }
    }

    // ==================== DAILY PROGRESS CACHING ====================

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
    
    getCurrentDateKey() {
        return new Date().toISOString().split('T')[0];
    }

    generateCacheVersion() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    async cleanupInvalidationFlags() {
        try {
            const pattern = `${this.keyPrefix}invalidated:*`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                await this.connectionManager.clearPattern(pattern);
            } else if (this.redis) {
                const keys = await this.redis.keys(pattern);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            }
        } catch (error) {
            console.error('[CACHE] Error cleaning invalidation flags:', error);
        }
    }

    getPreloadStats() {
        return { ...this.preloadStats };
    }

    isPreloading() {
        return this.preloadingInProgress;
    }

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
            
            console.log(`[CACHE STATS] Counting Redis keys with prefix: ${this.keyPrefix}`);
            
            const stats = {
                avatars: await this.countRedisKeysDirect(redis, `avatar:*`),
                posters: await this.countRedisKeysDirect(redis, `poster:*`),
                cooldowns: await this.countRedisKeysDirect(redis, `cooldown:*`),
                leaderboards: await this.countRedisKeysDirect(redis, `leaderboard:*`),
                validated: await this.countRedisKeysDirect(redis, `validated:*`),
                daily: await this.countRedisKeysDirect(redis, `daily:*`),
                invalidated: await this.countRedisKeysDirect(redis, `invalidated:*`)
            };
            
            stats.total = Object.values(stats).reduce((sum, count) => sum + count, 0);
            stats.mode = 'Redis';
            stats.redis = true;
            
            console.log(`[CACHE STATS] Found: avatars=${stats.avatars}, posters=${stats.posters}, cooldowns=${stats.cooldowns}, total=${stats.total}`);
            
            try {
                const info = await redis.info('memory');
                const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'Unknown';
                stats.memoryUsed = usedMemory;
            } catch (error) {
                console.log('[CACHE STATS] Could not get Redis memory info');
            }
            
            return stats;
            
        } catch (error) {
            console.error('[CACHE STATS] Error getting cache stats:', error);
            return {
                mode: 'Error',
                entries: 0,
                redis: false,
                error: error.message
            };
        }
    }

    async countRedisKeysDirect(redis, pattern) {
        try {
            const fullPattern = `${this.keyPrefix}${pattern}`;
            
            console.log(`[CACHE STATS] Searching for pattern: ${fullPattern}`);
            
            const keys = await redis.keys(fullPattern);
            
            console.log(`[CACHE STATS] Pattern "${fullPattern}" found ${keys.length} keys`);
            if (keys.length > 0 && keys.length <= 5) {
                console.log(`[CACHE STATS] Sample keys: ${keys.slice(0, 3).join(', ')}`);
            }
            
            return keys.length;
            
        } catch (error) {
            console.error(`[CACHE STATS] Error counting keys for pattern ${pattern}:`, error);
            return 0;
        }
    }

    async countKeys(pattern) {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                return 0;
            }

            const redis = this.connectionManager.getRedis();
            
            let searchPattern = pattern;
            if (!pattern.startsWith(this.keyPrefix)) {
                searchPattern = `${this.keyPrefix}${pattern}`;
            }
            
            const keys = await redis.keys(searchPattern);
            return keys.length;
            
        } catch (error) {
            console.error(`[CACHE] Error counting keys for pattern ${pattern}:`, error);
            return 0;
        }
    }

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

    async testCache() {
        try {
            const testKey = `${this.keyPrefix}test:${Date.now()}`;
            const testValue = 'cache-test-value';
            
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
            
            let getValue = null;
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                getValue = await this.connectionManager.getCache(testKey);
            } else if (this.redis) {
                getValue = await this.redis.get(testKey);
            }
            
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

    // ==================== DEBUG METHODS ====================

    async debugCacheContents() {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                console.log('[CACHE DEBUG] Redis not available for debug');
                return false;
            }

            const redis = this.connectionManager.getRedis();
            console.log('[CACHE DEBUG] ================ CACHE CONTENTS DEBUG ================');
            
            const categories = [
                { name: 'Avatars', pattern: `${this.keyPrefix}avatar:*` },
                { name: 'Posters', pattern: `${this.keyPrefix}poster:*` },
                { name: 'Cooldowns', pattern: `${this.keyPrefix}cooldown:*` },
                { name: 'Leaderboards', pattern: `${this.keyPrefix}leaderboard:*` },
                { name: 'Validated', pattern: `${this.keyPrefix}validated:*` }
            ];

            for (const category of categories) {
                const keys = await redis.keys(category.pattern);
                console.log(`[CACHE DEBUG] ${category.name}: ${keys.length} keys`);
                
                if (keys.length > 0) {
                    const samples = keys.slice(0, 3);
                    for (const key of samples) {
                        try {
                            const type = await redis.type(key);
                            const ttl = await redis.ttl(key);
                            const size = type === 'string' ? (await redis.strlen(key)) : 'N/A';
                            console.log(`[CACHE DEBUG]   - ${key} (${type}, TTL: ${ttl}s, Size: ${size})`);
                        } catch (keyError) {
                            console.log(`[CACHE DEBUG]   - ${key} (error getting info)`);
                        }
                    }
                    
                    if (keys.length > 3) {
                        console.log(`[CACHE DEBUG]   - ...and ${keys.length - 3} more`);
                    }
                }
            }
            
            console.log('[CACHE DEBUG] ================ END CACHE DEBUG ================');
            return true;
            
        } catch (error) {
            console.error('[CACHE DEBUG] Error debugging cache contents:', error);
            return false;
        }
    }

    async manualCacheTest() {
        try {
            console.log('[CACHE TEST] Starting comprehensive manual cache test...');
            
            const testKey = `${this.keyPrefix}test:${Date.now()}`;
            const testValue = JSON.stringify({ test: true, timestamp: Date.now() });
            
            console.log('[CACHE TEST] Testing basic cache operations...');
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                
                const setResult = await this.connectionManager.setCache(testKey, testValue, 60);
                console.log(`[CACHE TEST] Set result: ${setResult}`);
                
                const getValue = await this.connectionManager.getCache(testKey);
                console.log(`[CACHE TEST] Get result: ${getValue !== null ? 'SUCCESS' : 'FAILED'}`);
                console.log(`[CACHE TEST] Retrieved value: ${getValue}`);
                
                await this.connectionManager.deleteCache(testKey);
                const deletedValue = await this.connectionManager.getCache(testKey);
                console.log(`[CACHE TEST] Delete result: ${deletedValue === null ? 'SUCCESS' : 'FAILED'}`);
                
                console.log('[CACHE TEST] Testing binary cache operations...');
                const binaryKey = `${this.keyPrefix}test:binary:${Date.now()}`;
                const binaryValue = Buffer.from('test binary data for cache');
                
                const binarySetResult = await this.connectionManager.setBinaryCache(binaryKey, binaryValue, 60);
                console.log(`[CACHE TEST] Binary set result: ${binarySetResult}`);
                
                const binaryGetValue = await this.connectionManager.getBinaryCache(binaryKey);
                console.log(`[CACHE TEST] Binary get result: ${binaryGetValue && Buffer.isBuffer(binaryGetValue) ? 'SUCCESS' : 'FAILED'}`);
                
                await this.connectionManager.deleteCache(binaryKey);
                
            } else {
                console.log('[CACHE TEST] Redis not available, skipping tests');
            }
            
            console.log('[CACHE TEST] Manual cache test complete');
            return true;
            
        } catch (error) {
            console.error('[CACHE TEST] Error in manual cache test:', error);
            return false;
        }
    }

    async debugPreloadUser(guild, userId) {
        try {
            console.log(`[CACHE DEBUG] Force preloading user ${userId} in guild ${guild.name}`);
            
            let member;
            try {
                member = guild.members.cache.get(userId);
                if (!member) {
                    member = await guild.members.fetch(userId);
                }
            } catch (memberError) {
                console.log(`[CACHE DEBUG] Could not fetch member ${userId}: ${memberError.message}`);
                return false;
            }
            
            if (!member) {
                console.log(`[CACHE DEBUG] Member ${userId} not found in guild`);
                return false;
            }
            
            const userData = {
                user_id: userId,
                level: 1,
                total_xp: 1000
            };
            
            console.log(`[CACHE DEBUG] Starting preload for ${member.displayName}...`);
            await this.preloadUserCache(guild, userData);
            
            console.log(`[CACHE DEBUG] Completed force preload for user ${userId}`);
            return true;
            
        } catch (error) {
            console.error(`[CACHE DEBUG] Error force preloading user ${userId}:`, error);
            return false;
        }
    }

    async debugClearAllCache() {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                console.log('[CACHE DEBUG] Redis not available for cache clearing');
                return false;
            }

            const redis = this.connectionManager.getRedis();
            
            const keys = await redis.keys(`${this.keyPrefix}*`);
            
            console.log(`[CACHE DEBUG] Found ${keys.length} cache keys to clear`);
            
            if (keys.length > 0) {
                const batchSize = 100;
                let totalCleared = 0;
                
                for (let i = 0; i < keys.length; i += batchSize) {
                    const batch = keys.slice(i, i + batchSize);
                    const result = await redis.del(...batch);
                    totalCleared += result;
                    console.log(`[CACHE DEBUG] Cleared batch ${Math.floor(i/batchSize) + 1}: ${result} keys`);
                }
                
                console.log(`[CACHE DEBUG] Total cleared: ${totalCleared} cache keys`);
                return totalCleared;
            }
            
            return 0;
        } catch (error) {
            console.error('[CACHE DEBUG] Error clearing cache:', error);
            return false;
        }
    }

    async cleanup() {
        try {
            console.log('[CACHE] Cache manager cleanup complete');
        } catch (error) {
            console.error('[CACHE] Error during cleanup:', error);
        }
    }
}

module.exports = RedisCacheManager;
