/**
 * RedisCacheManager - High-level caching interface for Leveling-Bot
 * FIXED: Redis KEYS command doesn't automatically use keyPrefix in ioredis
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
            // Get all active guilds
            const guilds = client.guilds.cache;
            console.log(`[PRELOAD] Processing ${guilds.size} guilds for cache preloading`);

            for (const [guildId, guild] of guilds) {
                console.log(`[PRELOAD] ⭐ === Processing guild: ${guild.name} (${guild.memberCount || 'unknown'} members) ===`);
                
                try {
                    await this.preloadGuildCache(guild, databaseManager);
                } catch (guildError) {
                    console.error(`[PRELOAD] ❌ Error preloading guild ${guild.name}:`, guildError);
                    this.preloadStats.errors++;
                }

                // Small delay between guilds to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Log progress every few guilds
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
            console.log(`[PRELOAD]   Total Users Processed: ${this.preloadStats.totalUsers}`);
            console.log(`[PRELOAD]   Avatars Successfully Preloaded: ${this.preloadStats.avatarsPreloaded}`);
            console.log(`[PRELOAD]   Posters Successfully Preloaded: ${this.preloadStats.postersPreloaded}`);
            console.log(`[PRELOAD]   Total Items Cached: ${this.preloadStats.avatarsPreloaded + this.preloadStats.postersPreloaded}`);
            console.log(`[PRELOAD]   Errors Encountered: ${this.preloadStats.errors}`);
            console.log(`[PRELOAD]   Average Rate: ${Math.round(this.preloadStats.totalUsers / duration)} users/second`);
            console.log(`[PRELOAD]   Success Rate: ${Math.round(((this.preloadStats.avatarsPreloaded + this.preloadStats.postersPreloaded) / (this.preloadStats.totalUsers * 2)) * 100)}%`);

            return true;

        } catch (error) {
            console.error('[PRELOAD] ❌ Critical error in ENHANCED cache preloading:', error);
            return false;
        } finally {
            this.preloadingInProgress = false;
        }
    }

    /**
     * Enhanced preload cache for a specific guild
     */
    async preloadGuildCache(guild, databaseManager) {
        try {
            console.log(`[PRELOAD] 🏴‍☠️ Processing guild: ${guild.name} (ID: ${guild.id})`);
            
            // Get top users from database with better query
            const topUsers = await databaseManager.getLeaderboard(guild.id, 50);
            
            if (!topUsers || topUsers.length === 0) {
                console.log(`[PRELOAD] ⚠️ No users found in database for guild ${guild.name}`);
                return;
            }

            console.log(`[PRELOAD] 📊 Found ${topUsers.length} database users in ${guild.name}`);

            // Process users in smaller, more manageable batches
            const batchSize = 3; // Small batches for stability
            let processedUsers = 0;
            let successfulPreloads = 0;
            
            for (let i = 0; i < topUsers.length; i += batchSize) {
                const batch = topUsers.slice(i, i + batchSize);
                
                console.log(`[PRELOAD] 📦 Guild ${guild.name} - Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(topUsers.length/batchSize)}`);
                
                // Process batch with better error handling
                const batchResults = await Promise.allSettled(
                    batch.map(async (userData) => {
                        try {
                            // Pre-increment for tracking
                            this.preloadStats.totalUsers++;
                            processedUsers++;
                            
                            await this.preloadUserCache(guild, userData);
                            successfulPreloads++;
                            
                            return { success: true, userId: userData.user_id };
                        } catch (userError) {
                            console.error(`[PRELOAD] ❌ Error preloading user ${userData.user_id}:`, userError);
                            this.preloadStats.errors++;
                            return { success: false, userId: userData.user_id, error: userError.message };
                        }
                    })
                );
                
                // Log batch results
                const successful = batchResults.filter(r => r.value?.success).length;
                console.log(`[PRELOAD] 📋 Batch result: ${successful}/${batch.length} successful`);

                // Progress logging for larger guilds
                if (processedUsers > 0 && processedUsers % 15 === 0) {
                    console.log(`[PRELOAD] ⚡ Guild ${guild.name} progress: ${processedUsers}/${topUsers.length} users (${successfulPreloads} successful preloads)`);
                }

                // Delay between batches to prevent API spam
                if (i + batchSize < topUsers.length) {
                    await new Promise(resolve => setTimeout(resolve, 800)); // 800ms delay
                }
            }

            const successRate = Math.round((successfulPreloads / processedUsers) * 100);
            console.log(`[PRELOAD] ✅ Guild ${guild.name} complete: ${processedUsers}/${topUsers.length} users processed (${successRate}% success rate)`);

        } catch (error) {
            console.error(`[PRELOAD] ❌ Critical error in guild ${guild.name}:`, error);
            throw error;
        }
    }

    /**
     * Enhanced preload user cache with better tracking
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
                // User might have left the guild, skip silently
                return;
            }

            if (!member || member.user.bot) {
                return; // Skip bots and invalid members
            }

            console.log(`[PRELOAD] 🔍 Processing ${member.user.username} (Level ${userData.level})`);

            // PRELOAD AVATAR with result tracking
            const avatarResult = await this.preloadUserAvatar(member.user);
            if (avatarResult.success) {
                this.preloadStats.avatarsPreloaded++;
                console.log(`[PRELOAD] ✅ Avatar cached: ${member.user.username}`);
            } else {
                console.log(`[PRELOAD] ⚠️ Avatar failed: ${member.user.username} - ${avatarResult.error}`);
            }

            // PRELOAD WANTED POSTER with result tracking
            const posterResult = await this.preloadUserPoster(userData, member, guild);
            if (posterResult.success) {
                this.preloadStats.postersPreloaded++;
                console.log(`[PRELOAD] ✅ Poster cached: ${member.user.username} (Level ${userData.level})`);
            } else {
                console.log(`[PRELOAD] ⚠️ Poster failed: ${member.user.username} - ${posterResult.error}`);
            }

        } catch (error) {
            console.error(`[PRELOAD] ❌ Error preloading user ${userData.user_id}:`, error);
            this.preloadStats.errors++;
        }
    }

    /**
     * Preload user avatar - FIXED TO ACTUALLY LOAD AND CACHE
     */
    async preloadUserAvatar(user) {
        try {
            console.log(`[PRELOAD] 🖼️ Processing avatar for ${user.username}...`);
            
            const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
            const avatarHash = this.extractAvatarHash(avatarURL);
            
            if (!avatarHash) {
                console.log(`[PRELOAD] ⚠️ No avatar hash for ${user.username}, using default`);
                // Try to preload default avatar instead
                return await this.preloadDefaultAvatar(user);
            }

            // CRITICAL FIX: DON'T SKIP BASED ON CACHE - ALWAYS TRY TO LOAD
            console.log(`[PRELOAD] 📥 Loading avatar for ${user.username} from ${avatarURL}`);
            
            const { loadImage, createCanvas } = require('canvas');
            
            try {
                // Load avatar from Discord with timeout
                const avatar = await Promise.race([
                    loadImage(avatarURL),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Avatar load timeout')), 8000))
                ]);
                
                // Convert to buffer for caching
                const tempCanvas = createCanvas(512, 512);
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(avatar, 0, 0, 512, 512);
                const buffer = tempCanvas.toBuffer();
                
                // CRITICAL: Actually cache the avatar
                const cacheSuccess = await this.cacheUserAvatar(user.id, avatarHash, buffer);
                
                if (cacheSuccess) {
                    console.log(`[PRELOAD] ✅ Cached avatar: ${user.username} (${Math.round(buffer.length/1024)}KB)`);
                    return { success: true, cached: true, size: buffer.length };
                } else {
                    console.log(`[PRELOAD] ❌ Failed to cache avatar: ${user.username}`);
                    return { success: false, error: 'Cache write failed' };
                }
                
            } catch (loadError) {
                console.log(`[PRELOAD] ⚠️ PNG failed for ${user.username}, trying JPG fallback...`);
                
                // Try JPEG format as fallback
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
                        console.log(`[PRELOAD] ✅ Cached JPG avatar: ${user.username}`);
                        return { success: true, cached: true, size: buffer.length };
                    }
                } catch (jpgError) {
                    console.log(`[PRELOAD] ⚠️ JPG also failed for ${user.username}, trying default`);
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
            
            // Use a special hash for default avatars
            const defaultHash = `default_${user.discriminator % 5}`;
            const cacheSuccess = await this.cacheUserAvatar(user.id, defaultHash, buffer);
            
            if (cacheSuccess) {
                console.log(`[PRELOAD] ✅ Cached default avatar: ${user.username}`);
                return { success: true, cached: true, size: buffer.length, isDefault: true };
            }
            
            return { success: false, error: 'Default avatar cache failed' };
        } catch (error) {
            console.log(`[PRELOAD] ❌ Failed to load default avatar for ${user.username}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Preload user wanted poster - FIXED TO ACTUALLY GENERATE AND CACHE
     */
    async preloadUserPoster(userData, member, guild) {
        try {
            console.log(`[PRELOAD] 🎨 Processing poster for ${member.displayName} (Level ${userData.level})`);
            
            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalculator = new BountyCalculator();
            const bounty = bountyCalculator.getBountyForLevel(userData.level);

            // CRITICAL FIX: ALWAYS GENERATE THE POSTER, DON'T SKIP
            console.log(`[PRELOAD] 🎨 Generating poster for ${member.displayName} (Level ${userData.level}, Bounty: ฿${bounty.toLocaleString()})`);

            // Generate poster using CanvasGenerator
            const CanvasGenerator = require('../utils/CanvasGenerator');
            const canvasGenerator = new CanvasGenerator(this); // Pass cache manager
            
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
                
                // CRITICAL: Cache the poster directly
                const cacheSuccess = await this.cacheWantedPoster(userData.user_id, userData.level, bounty, buffer);
                
                if (cacheSuccess) {
                    console.log(`[PRELOAD] ✅ Generated and cached poster: ${member.displayName} (${Math.round(buffer.length/1024)}KB)`);
                    return { success: true, cached: true, size: buffer.length };
                } else {
                    console.log(`[PRELOAD] ❌ Poster generated but cache failed: ${member.displayName}`);
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
     * Extract avatar hash from Discord avatar URL - ENHANCED
     */
    extractAvatarHash(avatarURL) {
        try {
            // Handle both new and old Discord avatar URL formats
            const patterns = [
                /avatars\/(\d+)\/([a-f0-9]+)\.(png|jpg|gif|webp)/i,  // Standard format
                /\/([a-f0-9]{32})\.(png|jpg|gif|webp)/i,             // Direct hash format
                /embed\/avatars\/(\d+)\.png/i                        // Default avatar format
            ];
            
            for (const pattern of patterns) {
                const match = avatarURL.match(pattern);
                if (match) {
                    if (pattern.source.includes('embed')) {
                        // Default avatar
                        return `default_${match[1]}`;
                    } else {
                        // Custom avatar hash
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

    // ==================== LEADERBOARD CACHING WITH RACE PROTECTION ====================
    
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
     * ENHANCED: Cache validated users with timestamp protection
     */
    async cacheValidatedUsers(guildId, users) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            const ttl = 600; // 10 minutes
            
            // Add timestamp and version to cache entry
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

    /**
     * ENHANCED: Get cached validated users with staleness check
     */
    async getCachedValidatedUsers(guildId) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const data = await this.connectionManager.getCache(key);
                if (data) {
                    const cacheData = JSON.parse(data);
                    
                    // Check if cache is too old (older than 8 minutes = 480 seconds)
                    const cacheAge = Date.now() - cacheData.cachedAt;
                    if (cacheAge > 480000) { // 8 minutes
                        console.log(`[CACHE] Validated users cache too old (${Math.round(cacheAge/1000)}s), ignoring`);
                        return null;
                    }
                    
                    return cacheData.users;
                }
            } else if (this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    const cacheData = JSON.parse(data);
                    
                    // Check staleness
                    const cacheAge = Date.now() - cacheData.cachedAt;
                    if (cacheAge > 480000) { // 8 minutes
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

    /**
     * ENHANCED: Safe cache write - only cache if key wasn't recently invalidated
     */
    async safeWriteValidatedUsers(guildId, users) {
        try {
            const key = `${this.keyPrefix}validated:${guildId}`;
            
            // Check if key exists and was recently invalidated
            const existingData = await this.getCachedValidatedUsers(guildId);
            
            // If cache exists and is very fresh (< 30 seconds), don't overwrite
            // This prevents race condition overwrites
            if (existingData) {
                console.log('[CACHE] Recent cache exists, skipping write to prevent race condition');
                return false;
            }
            
            // Check invalidation flag
            const invalidationFlag = `${this.keyPrefix}invalidated:${guildId}`;
            
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                const wasInvalidated = await this.connectionManager.getCache(invalidationFlag);
                if (wasInvalidated) {
                    const invalidatedAt = parseInt(wasInvalidated);
                    const timeSinceInvalidation = Date.now() - invalidatedAt;
                    
                    if (timeSinceInvalidation < 30000) { // Less than 30 seconds
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

    /**
     * ENHANCED: Invalidate guild cache with flag setting
     */
    async invalidateGuildCache(guildId) {
        try {
            const patterns = [
                `${this.keyPrefix}leaderboard:${guildId}:*`,
                `${this.keyPrefix}validated:${guildId}`
            ];

            // Set invalidation flag with 60 second TTL
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
                console.log(`[CACHE] Invalidated ${totalCleared} guild cache entries for ${guildId} with race protection`);
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
     * Generate cache version for consistency checking
     */
    generateCacheVersion() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Clear invalidation flags (call periodically)
     */
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
     * Get cache statistics with proper Redis key counting - FIXED FOR IOREDIS KEYPREFIX ISSUE
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
            
            console.log(`[CACHE STATS] Counting Redis keys with prefix: ${this.keyPrefix}`);
            
            // CRITICAL FIX: ioredis doesn't automatically apply keyPrefix to KEYS command
            // We need to search for the actual keys with prefix manually
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
            
            // Get Redis memory info if available
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

    /**
     * Count Redis keys directly with full prefix - FIXED FOR IOREDIS
     */
    async countRedisKeysDirect(redis, pattern) {
        try {
            // CRITICAL: ioredis doesn't apply keyPrefix to KEYS command automatically
            // We must include the full prefix manually
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

    /**
     * Count keys matching pattern - IMPROVED IMPLEMENTATION
     */
    async countKeys(pattern) {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                return 0;
            }

            const redis = this.connectionManager.getRedis();
            
            // Handle both with and without keyPrefix in pattern
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

    // ==================== DEBUG METHODS ====================

    /**
     * Debug cache contents
     */
    async debugCacheContents() {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                console.log('[CACHE DEBUG] Redis not available for debug');
                return false;
            }

            const redis = this.connectionManager.getRedis();
            console.log('[CACHE DEBUG] ================ CACHE CONTENTS DEBUG ================');
            
            // List sample keys from each category - FIXED FOR KEYPREFIX
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
                    // Show first few keys as examples
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

    /**
     * Manual cache test with comprehensive operations
     */
    async manualCacheTest() {
        try {
            console.log('[CACHE TEST] Starting comprehensive manual cache test...');
            
            // Test basic cache operations
            const testKey = `${this.keyPrefix}test:${Date.now()}`;
            const testValue = JSON.stringify({ test: true, timestamp: Date.now() });
            
            // Test 1: Basic cache set/get
            console.log('[CACHE TEST] Testing basic cache operations...');
            if (this.connectionManager && this.connectionManager.isRedisAvailable()) {
                
                // Set test
                const setResult = await this.connectionManager.setCache(testKey, testValue, 60);
                console.log(`[CACHE TEST] Set result: ${setResult}`);
                
                // Get test
                const getValue = await this.connectionManager.getCache(testKey);
                console.log(`[CACHE TEST] Get result: ${getValue !== null ? 'SUCCESS' : 'FAILED'}`);
                console.log(`[CACHE TEST] Retrieved value: ${getValue}`);
                
                // Delete test
                await this.connectionManager.deleteCache(testKey);
                const deletedValue = await this.connectionManager.getCache(testKey);
                console.log(`[CACHE TEST] Delete result: ${deletedValue === null ? 'SUCCESS' : 'FAILED'}`);
                
                // Test 2: Binary cache operations
                console.log('[CACHE TEST] Testing binary cache operations...');
                const binaryKey = `${this.keyPrefix}test:binary:${Date.now()}`;
                const binaryValue = Buffer.from('test binary data for cache');
                
                const binarySetResult = await this.connectionManager.setBinaryCache(binaryKey, binaryValue, 60);
                console.log(`[CACHE TEST] Binary set result: ${binarySetResult}`);
                
                const binaryGetValue = await this.connectionManager.getBinaryCache(binaryKey);
                console.log(`[CACHE TEST] Binary get result: ${binaryGetValue && Buffer.isBuffer(binaryGetValue) ? 'SUCCESS' : 'FAILED'}`);
                
                // Cleanup
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

    /**
     * Debug preload user method
     */
    async debugPreloadUser(guild, userId) {
        try {
            console.log(`[CACHE DEBUG] Force preloading user ${userId} in guild ${guild.name}`);
            
            // Get user from guild first
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
            
            // Create basic user data for preloading
            const userData = {
                user_id: userId,
                level: 1, // Default level for testing
                total_xp: 1000 // Default XP for testing
            };
            
            // Preload this user
            console.log(`[CACHE DEBUG] Starting preload for ${member.displayName}...`);
            await this.preloadUserCache(guild, userData);
            
            console.log(`[CACHE DEBUG] Completed force preload for user ${userId}`);
            return true;
            
        } catch (error) {
            console.error(`[CACHE DEBUG] Error force preloading user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Clear all cache (USE WITH EXTREME CAUTION) - FIXED FOR KEYPREFIX
     */
    async debugClearAllCache() {
        try {
            if (!this.connectionManager || !this.connectionManager.isRedisAvailable()) {
                console.log('[CACHE DEBUG] Redis not available for cache clearing');
                return false;
            }

            const redis = this.connectionManager.getRedis();
            
            // CRITICAL FIX: Use full keyPrefix in pattern for ioredis
            const keys = await redis.keys(`${this.keyPrefix}*`);
            
            console.log(`[CACHE DEBUG] Found ${keys.length} cache keys to clear`);
            
            if (keys.length > 0) {
                // Clear in batches to avoid timeout
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
