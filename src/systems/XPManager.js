const DatabaseManager = require('./DatabaseManager');
const BountyCalculator = require('../utils/BountyCalculator');
const LevelCalculator = require('../utils/LevelCalculator');
const DailyCapManager = require('./DailyCapManager');
const LevelUpHandler = require('./LevelUpHandler');
const XPLogger = require('../utils/XPLogger');

/**
 * XPManager - Main XP tracking and management system
 * FIXED VERSION - Now properly handles existing voice sessions on startup
 */
class XPManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.cooldowns = new Map();
        
        // Initialize sub-systems with proper initialization
        this.dbManager = new DatabaseManager(db);
        this.bountyCalculator = new BountyCalculator();
        this.levelCalculator = new LevelCalculator();
        this.dailyCapManager = new DailyCapManager(db);
        this.levelUpHandler = new LevelUpHandler(client, db);
        this.xpLogger = new XPLogger(client);
    }

    /**
     * Initialize the XP manager - UPDATED WITH FIXED VOICE SESSION SYNC
     */
    async initialize() {
        try {
            console.log('⚡ Initializing XP Manager...');
            
            // Initialize daily cap manager
            await this.dailyCapManager.initialize();
            
            // Clean up any existing orphaned sessions first
            await this.cleanupOrphanedVoiceSessions();
            
            // Sync existing voice sessions on startup with proper timing
            await this.syncExistingVoiceSessions();
            
            // Start voice XP processing interval
            this.startVoiceXPProcessing();
            
            // Start daily reset schedule
            this.scheduleDailyReset();
            
            console.log('✅ XP Manager initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing XP Manager:', error);
            throw error;
        }
    }

    /**
     * Sync existing voice sessions on bot startup - FIXED VERSION
     */
    async syncExistingVoiceSessions() {
        try {
            console.log('🎤 [VOICE SYNC] Syncing existing voice sessions...');
            
            let totalSynced = 0;
            let totalIgnored = 0;
            
            for (const [guildId, guild] of this.client.guilds.cache) {
                console.log(`🎤 [VOICE SYNC] Checking guild: ${guild.name}`);
                
                // Get all voice channels in the guild
                const voiceChannels = guild.channels.cache.filter(channel => channel.type === 2); // GUILD_VOICE = 2
                
                for (const [channelId, channel] of voiceChannels) {
                    if (channel.members.size > 0) {
                        console.log(`🎤 [VOICE SYNC] Checking voice channel: ${channel.name} (${channel.members.size} total members)`);
                        
                        for (const [userId, member] of channel.members) {
                            // IGNORE BOTS - THIS WAS THE MISSING PART!
                            if (member.user.bot) {
                                console.log(`🎤 [VOICE SYNC] Ignoring bot: ${member.user.username}`);
                                totalIgnored++;
                                continue;
                            }
                            
                            console.log(`🎤 [VOICE SYNC] Found user in voice: ${member.user.username} in ${channel.name}`);
                            
                            // Create voice session for existing user with ADJUSTED TIMING
                            // Set last_xp_time to allow immediate XP processing
                            const adjustedTime = new Date(Date.now() - (parseInt(process.env.VOICE_COOLDOWN) || 300000));
                            
                            await this.dbManager.setVoiceSessionWithTime(
                                userId,
                                guildId,
                                channelId,
                                member.voice.mute || member.voice.selfMute || false,
                                member.voice.deaf || member.voice.selfDeaf || false,
                                adjustedTime // This allows immediate XP processing
                            );
                            
                            totalSynced++;
                            console.log(`🎤 [VOICE SYNC] Synced voice session for ${member.user.username} (ready for XP)`);
                        }
                    }
                }
            }
            
            console.log(`🎤 [VOICE SYNC] Sync complete: ${totalSynced} users synced, ${totalIgnored} bots ignored`);
            
            // Process voice XP immediately for synced sessions
            if (totalSynced > 0) {
                console.log(`🎤 [VOICE SYNC] Processing initial XP for ${totalSynced} synced sessions...`);
                setTimeout(() => {
                    this.processVoiceXP().catch(console.error);
                }, 5000); // Give 5 seconds for everything to settle
            }
        } catch (error) {
            console.error('❌ Error syncing existing voice sessions:', error);
        }
    }

    /**
     * Handle message XP with guild settings integration
     */
    async handleMessageXP(message) {
        try {
            const userId = message.author.id;
            const guildId = message.guild.id;
            
            // IGNORE BOTS
            if (message.author.bot) {
                return;
            }
            
            const cooldownKey = `${guildId}:${userId}:message`;
            const cooldownMs = parseInt(process.env.MESSAGE_COOLDOWN) || 60000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Get member for XP award
            const member = message.member;
            if (!member) return;

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId, member);
            if (!canGainXP.allowed) {
                return;
            }

            // Get guild settings for XP values
            const guildSettings = await this.dbManager.getGuildSettings(guildId);
            
            // Calculate XP using guild settings or environment defaults
            const minXP = guildSettings?.message_xp_min || parseInt(process.env.MESSAGE_XP_MIN) || 75;
            const maxXP = guildSettings?.message_xp_max || parseInt(process.env.MESSAGE_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            
            // Apply guild XP multiplier
            const guildMultiplier = guildSettings?.xp_multiplier || 1.0;
            
            const finalXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'message', message.author, member);
            
            // Set cooldown
            this.setCooldown(cooldownKey);

        } catch (error) {
            console.error('Error handling message XP:', error);
        }
    }

    /**
     * Handle reaction XP with guild settings integration
     */
    async handleReactionXP(reaction, user) {
        try {
            const userId = user.id;
            const guildId = reaction.message.guild.id;
            
            // IGNORE BOTS
            if (user.bot) {
                return;
            }
            
            const cooldownKey = `${guildId}:${userId}:reaction`;
            const cooldownMs = parseInt(process.env.REACTION_COOLDOWN) || 300000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Get member
            const guild = this.client.guilds.cache.get(guildId);
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId, member);
            if (!canGainXP.allowed) {
                return;
            }

            // Get guild settings for XP values
            const guildSettings = await this.dbManager.getGuildSettings(guildId);
            
            // Calculate XP using guild settings or environment defaults
            const minXP = guildSettings?.reaction_xp_min || parseInt(process.env.REACTION_XP_MIN) || 75;
            const maxXP = guildSettings?.reaction_xp_max || parseInt(process.env.REACTION_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            
            // Apply guild XP multiplier
            const guildMultiplier = guildSettings?.xp_multiplier || 1.0;
            
            const finalXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'reaction', user, member);
            
            // Set cooldown
            this.setCooldown(cooldownKey);

        } catch (error) {
            console.error('Error handling reaction XP:', error);
        }
    }

    /**
     * Handle voice state updates - CORRECTED WITH BOT FILTERING
     */
    async handleVoiceStateUpdate(oldState, newState) {
        try {
            const userId = newState.id || oldState.id;
            const guildId = newState.guild?.id || oldState.guild?.id;
            
            if (!guildId) return;

            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            const member = guild.members.cache.get(userId);
            if (!member) return;
            
            // IGNORE BOTS - CRITICAL FIX
            if (member.user.bot) {
                console.log(`🎤 [VOICE] Ignoring bot voice state change: ${member.user.username}`);
                return;
            }

            console.log(`🎤 [VOICE DEBUG] Processing voice state update for ${member.user.username}`);
            console.log(`🎤 [VOICE DEBUG] Old channel: ${oldState.channelId}, New channel: ${newState.channelId}`);

            // User joined a voice channel
            if (!oldState.channelId && newState.channelId) {
                console.log(`🎤 [VOICE] ${member.user.username} joined ${newState.channel.name}`);
                
                await this.dbManager.setVoiceSession(
                    userId, 
                    guildId, 
                    newState.channelId,
                    newState.mute || newState.selfMute,
                    newState.deaf || newState.selfDeaf
                );
            }
            // User left voice channel
            else if (oldState.channelId && !newState.channelId) {
                console.log(`🎤 [VOICE] ${member.user.username} left voice channel`);
                
                await this.dbManager.removeVoiceSession(userId, guildId);
            }
            // User moved channels or mute/deafen state changed
            else if (oldState.channelId && newState.channelId) {
                const oldMuted = oldState.mute || oldState.selfMute;
                const newMuted = newState.mute || newState.selfMute;
                const oldDeafened = oldState.deaf || oldState.selfDeaf;
                const newDeafened = newState.deaf || newState.selfDeaf;
                
                // If moved channels
                if (oldState.channelId !== newState.channelId) {
                    console.log(`🎤 [VOICE] ${member.user.username} moved to ${newState.channel.name}`);
                    
                    // Reset session for new channel
                    await this.dbManager.setVoiceSession(
                        userId, 
                        guildId, 
                        newState.channelId,
                        newMuted,
                        newDeafened
                    );
                }
                // Just mute/deafen state changed
                else if (oldMuted !== newMuted || oldDeafened !== newDeafened) {
                    console.log(`🎤 [VOICE] ${member.user.username} mute/deafen state changed`);
                    await this.dbManager.updateVoiceSession(userId, guildId, newMuted, newDeafened);
                }
            }

        } catch (error) {
            console.error('Error handling voice state update:', error);
        }
    }

    /**
     * Process voice XP for all active sessions - CORRECTED WITH BOT FILTERING
     */
    async processVoiceXP() {
        try {
            console.log(`🎤 [VOICE DEBUG] Processing voice XP for all guilds...`);
            
            // Get all voice sessions
            const guilds = this.client.guilds.cache;
            let totalSessionsProcessed = 0;
            let totalXPAwarded = 0;
            
            for (const [guildId, guild] of guilds) {
                const sessions = await this.dbManager.getVoiceSessions(guildId);
                console.log(`🎤 [VOICE DEBUG] Guild ${guild.name}: ${sessions.length} active voice sessions`);
                
                for (const session of sessions) {
                    const result = await this.processUserVoiceXP(session, guild);
                    if (result.xpAwarded > 0) {
                        totalXPAwarded += result.xpAwarded;
                        totalSessionsProcessed++;
                    }
                }
            }
            
            if (totalSessionsProcessed > 0) {
                console.log(`🎤 [VOICE DEBUG] Processed ${totalSessionsProcessed} sessions, awarded ${totalXPAwarded} total XP`);
            }

        } catch (error) {
            console.error('Error processing voice XP:', error);
        }
    }

    /**
     * Process voice XP for individual user with guild settings - FIXED VERSION
     */
    async processUserVoiceXP(session, guild) {
        try {
            const now = Date.now();
            const cooldownMs = parseInt(process.env.VOICE_COOLDOWN) || 300000; // 5 minutes
            const minMembers = parseInt(process.env.VOICE_MIN_MEMBERS) || 2;
            const antiAFK = process.env.VOICE_ANTI_AFK === 'true';
            
            console.log(`🎤 [VOICE DEBUG] Processing XP for user ${session.user_id} in channel ${session.channel_id}`);
            
            // Check cooldown - FIXED: Allow immediate processing for newly synced sessions
            const lastXPTime = new Date(session.last_xp_time).getTime();
            const timeSinceLastXP = now - lastXPTime;
            const joinTime = new Date(session.join_time).getTime();
            const timeSinceJoin = now - joinTime;
            
            console.log(`🎤 [VOICE DEBUG] Time since last XP: ${Math.round(timeSinceLastXP/1000)}s (cooldown: ${cooldownMs/1000}s)`);
            console.log(`🎤 [VOICE DEBUG] Time since join: ${Math.round(timeSinceJoin/1000)}s`);
            
            // For synced sessions, allow processing if they've been in channel for at least the cooldown period
            // OR if enough time has passed since last XP award
            const canProcessXP = (timeSinceLastXP >= cooldownMs) || 
                                 (timeSinceJoin >= cooldownMs && lastXPTime === joinTime);
            
            if (!canProcessXP) {
                console.log(`🎤 [VOICE DEBUG] User ${session.user_id} not ready for XP yet`);
                return { xpAwarded: 0, reason: 'cooldown' };
            }

            // Get channel and check if it still exists
            const channel = guild.channels.cache.get(session.channel_id);
            if (!channel) {
                console.log(`🎤 [VOICE DEBUG] Channel ${session.channel_id} no longer exists, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'channel_not_found' };
            }

            // Check member count in channel (IGNORE BOTS)
            const humanMembers = channel.members.filter(m => !m.user.bot);
            const memberCount = humanMembers.size;
            console.log(`🎤 [VOICE DEBUG] Channel ${channel.name} has ${memberCount} human members (${channel.members.size} total including bots, minimum required: ${minMembers})`);
            
            if (memberCount < minMembers) {
                console.log(`🎤 [VOICE DEBUG] Not enough human members in channel for XP`);
                return { xpAwarded: 0, reason: 'insufficient_members' };
            }

            // Get member
            const member = await guild.members.fetch(session.user_id).catch(() => null);
            if (!member) {
                console.log(`🎤 [VOICE DEBUG] Member ${session.user_id} not found, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'member_not_found' };
            }

            // DOUBLE CHECK: Ignore bots (safety check)
            if (member.user.bot) {
                console.log(`🎤 [VOICE DEBUG] Removing bot from voice sessions: ${member.user.username}`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'bot_removed' };
            }

            // Check if member is actually in the voice channel
            const memberVoiceState = member.voice;
            if (!memberVoiceState.channelId || memberVoiceState.channelId !== session.channel_id) {
                console.log(`🎤 [VOICE DEBUG] Member ${member.user.username} not in expected voice channel, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'not_in_channel' };
            }

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(session.user_id, session.guild_id, member);
            console.log(`🎤 [VOICE DEBUG] Can gain XP: ${canGainXP.allowed} (${canGainXP.currentXP}/${canGainXP.dailyCap})`);
            
            if (!canGainXP.allowed) {
                console.log(`🎤 [VOICE DEBUG] User ${member.user.username} has reached daily cap`);
                return { xpAwarded: 0, reason: 'daily_cap_reached' };
            }

            // Get guild settings for voice XP values
            const guildSettings = await this.dbManager.getGuildSettings(session.guild_id);

            // Calculate base XP using guild settings or environment defaults
            const minXP = guildSettings?.voice_xp_min || parseInt(process.env.VOICE_XP_MIN) || 250;
            const maxXP = guildSettings?.voice_xp_max || parseInt(process.env.VOICE_XP_MAX) || 350;
            let baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;

            console.log(`🎤 [VOICE DEBUG] Base XP calculated: ${baseXP} (Guild settings: ${minXP}-${maxXP})`);

            // Apply AFK penalty if enabled
            if (antiAFK && (session.is_muted || session.is_deafened)) {
                const exemptUsers = (process.env.VOICE_MUTE_EXEMPT_USERS || '').split(',').filter(id => id.trim());
                const exemptRoles = (process.env.VOICE_MUTE_EXEMPT_ROLES || '').split(',').filter(id => id.trim());
                const exemptMultiplier = parseFloat(process.env.VOICE_MUTE_EXEMPT_MULTIPLIER) || 1.0;
                
                let isExempt = false;
                
                // Check user exemption
                if (exemptUsers.includes(session.user_id)) {
                    isExempt = true;
                    baseXP = Math.round(baseXP * exemptMultiplier);
                    console.log(`🎤 [VOICE DEBUG] User exempt from AFK penalty, XP: ${baseXP}`);
                }
                
                // Check role exemption
                if (!isExempt && exemptRoles.length > 0) {
                    for (const roleId of exemptRoles) {
                        if (member.roles.cache.has(roleId.trim())) {
                            isExempt = true;
                            baseXP = Math.round(baseXP * exemptMultiplier);
                            console.log(`🎤 [VOICE DEBUG] Role exempt from AFK penalty, XP: ${baseXP}`);
                            break;
                        }
                    }
                }
                
                // Apply penalty if not exempt
                if (!isExempt) {
                    baseXP = Math.round(baseXP * 0.25); // 25% XP when muted/deafened
                    console.log(`🎤 [VOICE DEBUG] AFK penalty applied, XP reduced to: ${baseXP}`);
                }
            }

            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            
            // Apply guild XP multiplier
            const guildMultiplier = guildSettings?.xp_multiplier || 1.0;
            
            const finalXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            console.log(`🎤 [VOICE DEBUG] Final XP to award: ${finalXP} (tier: ${tierMultiplier}x, guild: ${guildMultiplier}x)`);

            // Award XP
            await this.awardXP(session.user_id, session.guild_id, finalXP, 'voice', member.user, member);
            
            console.log(`🎤 [VOICE DEBUG] ✅ XP awarded to ${member.user.username}: ${finalXP}`);

            // Update last XP time
            await this.dbManager.updateVoiceSession(session.user_id, session.guild_id, session.is_muted, session.is_deafened);

            return { xpAwarded: finalXP, reason: 'success' };

        } catch (error) {
            console.error(`Error processing user voice XP for ${session.user_id}:`, error);
            return { xpAwarded: 0, reason: 'error' };
        }
    }

    /**
     * Award XP and handle level ups
     */
    async awardXP(userId, guildId, xpAmount, source, user, member) {
        try {
            // Apply global multiplier from environment (final multiplier)
            const globalMultiplier = parseFloat(process.env.XP_MULTIPLIER) || 1.0;
            const finalXP = Math.round(xpAmount * globalMultiplier);

            // Update daily cap tracking
            await this.dailyCapManager.addXP(userId, guildId, finalXP, source, member);

            // Get current user data
            const currentData = await this.dbManager.getUserXP(userId, guildId);
            const oldLevel = currentData?.level || 0;

            // Update user XP
            const result = await this.dbManager.updateUserXP(userId, guildId, finalXP, source);
            if (!result) return;

            // Calculate new level
            const newLevel = this.levelCalculator.calculateLevel(result.total_xp);
            
            // Update level if changed
            if (newLevel !== oldLevel) {
                await this.dbManager.updateUserLevel(userId, guildId, newLevel);
                
                // Handle level up with guild settings
                await this.levelUpHandler.handleLevelUp(
                    userId, guildId, oldLevel, newLevel, result.total_xp, user, member, source
                );
            }

            // Log XP activity with guild settings
            await this.xpLogger.logXPActivity(source, user, guildId, finalXP, {
                totalXP: result.total_xp,
                currentLevel: newLevel,
                oldLevel: oldLevel,
                source: source,
                member: member
            });

        } catch (error) {
            console.error('Error awarding XP:', error);
        }
    }

    /**
     * Get tier multiplier for member
     */
    async getTierMultiplier(member) {
        try {
            if (!member) return 1.0;

            // Check for tier roles (highest tier wins)
            for (let tier = 10; tier >= 1; tier--) {
                const roleId = process.env[`TIER_${tier}_ROLE`];
                if (roleId && member.roles.cache.has(roleId)) {
                    // Tier roles don't provide multiplier, just increase daily cap
                    // The daily cap is handled in DailyCapManager
                    return 1.0;
                }
            }

            return 1.0;
        } catch (error) {
            console.error('Error getting tier multiplier:', error);
            return 1.0;
        }
    }

    /**
     * Get guild settings with caching
     */
    async getGuildSettings(guildId) {
        try {
            return await this.dbManager.getGuildSettings(guildId);
        } catch (error) {
            console.error('Error getting guild settings:', error);
            return null;
        }
    }

    /**
     * Update guild setting
     */
    async updateGuildSetting(guildId, settingName, settingValue) {
        try {
            return await this.dbManager.updateGuildSetting(guildId, settingName, settingValue);
        } catch (error) {
            console.error('Error updating guild setting:', error);
            return false;
        }
    }

    /**
     * Start voice XP processing interval - UPDATED VERSION
     */
    startVoiceXPProcessing() {
        const interval = parseInt(process.env.VOICE_PROCESSING_INTERVAL) || 300000; // 5 minutes
        
        console.log(`🎤 Starting voice XP processing with ${interval / 1000}s intervals`);
        
        setInterval(() => {
            console.log(`🎤 [VOICE DEBUG] Voice XP processing interval triggered`);
            this.processVoiceXP().catch(console.error);
        }, interval);

        console.log(`🎤 Voice XP processing started (${interval / 1000}s interval)`);
    }

    /**
     * Schedule daily reset
     */
    scheduleDailyReset() {
        const scheduleNext = () => {
            const now = new Date();
            const resetHour = parseInt(process.env.DAILY_RESET_HOUR_EDT) || 19;
            const resetMinute = parseInt(process.env.DAILY_RESET_MINUTE_EDT) || 35;
            
            // Calculate next reset time in EDT
            const edtOffset = this.isEDT(now) ? -4 : -5;
            const edtNow = new Date(now.getTime() + (edtOffset * 60 * 60 * 1000));
            
            let nextReset = new Date(edtNow);
            nextReset.setHours(resetHour, resetMinute, 0, 0);
            
            // If reset time has passed today, schedule for tomorrow
            if (edtNow.getTime() >= nextReset.getTime()) {
                nextReset.setDate(nextReset.getDate() + 1);
            }
            
            // Convert back to UTC
            const utcReset = new Date(nextReset.getTime() - (edtOffset * 60 * 60 * 1000));
            const timeUntilReset = utcReset.getTime() - now.getTime();
            
            const hoursUntil = Math.floor(timeUntilReset / (1000 * 60 * 60));
            const minutesUntil = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));
            
            console.log(`🔄 Next daily reset in ${hoursUntil}h ${minutesUntil}m (${resetHour}:${resetMinute.toString().padStart(2, '0')} EDT)`);
            
            setTimeout(async () => {
                console.log('🚨 Daily reset triggered!');
                await this.dailyCapManager.resetDaily();
                scheduleNext();
            }, timeUntilReset);
        };
        
        scheduleNext();
    }

    /**
     * Check if date is EDT (Eastern Daylight Time)
     */
    isEDT(date) {
        const year = date.getFullYear();
        const marchSecondSunday = new Date(year, 2, 8);
        marchSecondSunday.setDate(marchSecondSunday.getDate() + (7 - marchSecondSunday.getDay()));
        const novemberFirstSunday = new Date(year, 10, 1);
        novemberFirstSunday.setDate(novemberFirstSunday.getDate() + (7 - novemberFirstSunday.getDay()));
        return date >= marchSecondSunday && date < novemberFirstSunday;
    }

    /**
     * Cooldown management
     */
    isOnCooldown(key, cooldownMs) {
        const now = Date.now();
        const lastUse = this.cooldowns.get(key);
        return lastUse && (now - lastUse) < cooldownMs;
    }

    setCooldown(key) {
        this.cooldowns.set(key, Date.now());
    }

    /**
     * Get current user stats
     */
    async getUserStats(userId, guildId) {
        try {
            const userData = await this.dbManager.getUserXP(userId, guildId);
            if (!userData) return null;

            const rank = await this.dbManager.getUserRank(userId, guildId);
            const bounty = this.bountyCalculator.getBountyForLevel(userData.level);
            
            return {
                ...userData,
                rank,
                bounty
            };
        } catch (error) {
            console.error('Error getting user stats:', error);
            return null;
        }
    }

    /**
     * Get leaderboard data
     */
    async getLeaderboard(guildId, limit = 50) {
        try {            
            const users = await this.dbManager.getLeaderboard(guildId, limit);
            
            return users.map(user => ({
                ...user,
                bounty: this.bountyCalculator.getBountyForLevel(user.level)
            }));
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            return [];
        }
    }

    /**
     * Cleanup orphaned voice sessions on startup
     */
    async cleanupOrphanedVoiceSessions() {
        try {
            console.log('🧹 [VOICE CLEANUP] Starting cleanup of orphaned voice sessions...');
            
            await this.dbManager.cleanupOrphanedVoiceSessions(this.client);
            
            console.log('🧹 [VOICE CLEANUP] Cleanup complete');
        } catch (error) {
            console.error('Error cleaning up orphaned voice sessions:', error);
        }
    }

    /**
     * Cleanup
     */
    async cleanup() {
        try {
            console.log('🧹 Cleaning up XP Manager...');
            
            if (this.dailyCapManager) {
                await this.dailyCapManager.cleanup();
            }
            
            // Clean up orphaned voice sessions
            await this.cleanupOrphanedVoiceSessions();
            
            this.cooldowns.clear();
            console.log('✅ XP Manager cleanup complete');
        } catch (error) {
            console.error('Error during XP Manager cleanup:', error);
        }
    }
}

module.exports = XPManager;
