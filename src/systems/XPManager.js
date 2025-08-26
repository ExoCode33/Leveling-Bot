const BountyCalculator = require('../utils/BountyCalculator');
const LevelCalculator = require('../utils/LevelCalculator');
const DailyCapManager = require('./DailyCapManager');
const LevelUpHandler = require('./LevelUpHandler');
const XPLogger = require('../utils/XPLogger');

/**
 * XPManager - Main XP tracking and management system
 */
class XPManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.cooldowns = new Map();
        
        // Initialize sub-systems
        this.bountyCalculator = new BountyCalculator();
        this.levelCalculator = new LevelCalculator();
        this.dailyCapManager = new DailyCapManager(db);
        this.levelUpHandler = new LevelUpHandler(client, db);
        this.xpLogger = new XPLogger(client);
    }

    /**
     * Initialize the XP manager
     */
    async initialize() {
        try {
            console.log('⚡ Initializing XP Manager...');
            
            // Initialize daily cap manager
            await this.dailyCapManager.initialize();
            
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
     * Handle message XP
     */
    async handleMessageXP(message) {
        try {
            const userId = message.author.id;
            const guildId = message.guild.id;
            const cooldownKey = `${guildId}:${userId}:message`;
            const cooldownMs = parseInt(process.env.MESSAGE_COOLDOWN) || 60000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId);
            if (!canGainXP.allowed) {
                return;
            }

            // Calculate XP
            const minXP = parseInt(process.env.MESSAGE_XP_MIN) || 75;
            const maxXP = parseInt(process.env.MESSAGE_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const member = message.member;
            const tierMultiplier = await this.getTierMultiplier(member);
            const finalXP = Math.round(baseXP * tierMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'message', message.author, member);
            
            // Set cooldown
            this.setCooldown(cooldownKey);

        } catch (error) {
            console.error('Error handling message XP:', error);
        }
    }

    /**
     * Handle reaction XP
     */
    async handleReactionXP(reaction, user) {
        try {
            const userId = user.id;
            const guildId = reaction.message.guild.id;
            const cooldownKey = `${guildId}:${userId}:reaction`;
            const cooldownMs = parseInt(process.env.REACTION_COOLDOWN) || 300000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId);
            if (!canGainXP.allowed) {
                return;
            }

            // Get member
            const guild = this.client.guilds.cache.get(guildId);
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;

            // Calculate XP
            const minXP = parseInt(process.env.REACTION_XP_MIN) || 75;
            const maxXP = parseInt(process.env.REACTION_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            const finalXP = Math.round(baseXP * tierMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'reaction', user, member);
            
            // Set cooldown
            this.setCooldown(cooldownKey);

        } catch (error) {
            console.error('Error handling reaction XP:', error);
        }
    }

    /**
     * Handle voice state updates
     */
    async handleVoiceStateUpdate(oldState, newState) {
        try {
            const userId = newState.id || oldState.id;
            const guildId = newState.guild?.id || oldState.guild?.id;
            
            if (!guildId) return;

            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            const member = guild.members.cache.get(userId);
            if (!member || member.user.bot) return;

            // User joined a voice channel
            if (!oldState.channelId && newState.channelId) {
                console.log(`[VOICE] ${member.user.username} joined ${newState.channel.name}`);
                
                const { DatabaseManager } = require('../systems/DatabaseManager');
                const dbManager = new DatabaseManager(this.db);
                
                await dbManager.setVoiceSession(
                    userId, 
                    guildId, 
                    newState.channelId,
                    newState.mute || newState.selfMute,
                    newState.deaf || newState.selfDeaf
                );
            }
            // User left voice channel
            else if (oldState.channelId && !newState.channelId) {
                console.log(`[VOICE] ${member.user.username} left voice channel`);
                
                const { DatabaseManager } = require('../systems/DatabaseManager');
                const dbManager = new DatabaseManager(this.db);
                await dbManager.removeVoiceSession(userId, guildId);
            }
            // User moved channels or mute/deafen state changed
            else if (oldState.channelId && newState.channelId) {
                const oldMuted = oldState.mute || oldState.selfMute;
                const newMuted = newState.mute || newState.selfMute;
                const oldDeafened = oldState.deaf || oldState.selfDeaf;
                const newDeafened = newState.deaf || newState.selfDeaf;
                
                // If moved channels
                if (oldState.channelId !== newState.channelId) {
                    console.log(`[VOICE] ${member.user.username} moved to ${newState.channel.name}`);
                }
                
                // Update session if mute/deafen state changed or moved
                if (oldMuted !== newMuted || oldDeafened !== newDeafened || oldState.channelId !== newState.channelId) {
                    const { DatabaseManager } = require('../systems/DatabaseManager');
                    const dbManager = new DatabaseManager(this.db);
                    
                    if (oldState.channelId !== newState.channelId) {
                        // Moved channels - reset session
                        await dbManager.setVoiceSession(
                            userId, 
                            guildId, 
                            newState.channelId,
                            newMuted,
                            newDeafened
                        );
                    } else {
                        // Just mute/deafen change
                        await dbManager.updateVoiceSession(userId, guildId, newMuted, newDeafened);
                    }
                }
            }

        } catch (error) {
            console.error('Error handling voice state update:', error);
        }
    }

    /**
     * Process voice XP for all active sessions
     */
    async processVoiceXP() {
        try {
            const { DatabaseManager } = require('../systems/DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            // Get all voice sessions
            const guilds = this.client.guilds.cache;
            
            for (const [guildId, guild] of guilds) {
                const sessions = await dbManager.getVoiceSessions(guildId);
                
                for (const session of sessions) {
                    await this.processUserVoiceXP(session, guild, dbManager);
                }
            }

        } catch (error) {
            console.error('Error processing voice XP:', error);
        }
    }

    /**
     * Process voice XP for individual user
     */
    async processUserVoiceXP(session, guild, dbManager) {
        try {
            const now = Date.now();
            const cooldownMs = parseInt(process.env.VOICE_COOLDOWN) || 300000;
            const minMembers = parseInt(process.env.VOICE_MIN_MEMBERS) || 2;
            const antiAFK = process.env.VOICE_ANTI_AFK === 'true';
            
            // Check cooldown
            const lastXPTime = new Date(session.last_xp_time).getTime();
            if (now - lastXPTime < cooldownMs) {
                return;
            }

            // Get channel and check member count
            const channel = guild.channels.cache.get(session.channel_id);
            if (!channel) {
                await dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return;
            }

            const memberCount = channel.members.filter(m => !m.user.bot).size;
            if (memberCount < minMembers) {
                return;
            }

            // Get member
            const member = await guild.members.fetch(session.user_id).catch(() => null);
            if (!member) {
                await dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return;
            }

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(session.user_id, session.guild_id);
            if (!canGainXP.allowed) {
                return;
            }

            // Calculate base XP
            const minXP = parseInt(process.env.VOICE_XP_MIN) || 250;
            const maxXP = parseInt(process.env.VOICE_XP_MAX) || 350;
            let baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;

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
                }
                
                // Check role exemption
                if (!isExempt && exemptRoles.length > 0) {
                    for (const roleId of exemptRoles) {
                        if (member.roles.cache.has(roleId.trim())) {
                            isExempt = true;
                            baseXP = Math.round(baseXP * exemptMultiplier);
                            break;
                        }
                    }
                }
                
                // Apply penalty if not exempt
                if (!isExempt) {
                    baseXP = Math.round(baseXP * 0.25); // 25% XP when muted/deafened
                }
            }

            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            const finalXP = Math.round(baseXP * tierMultiplier);

            // Award XP
            await this.awardXP(session.user_id, session.guild_id, finalXP, 'voice', member.user, member);
            
            // Update last XP time
            await dbManager.updateVoiceSession(session.user_id, session.guild_id, session.is_muted, session.is_deafened);

        } catch (error) {
            console.error('Error processing user voice XP:', error);
        }
    }

    /**
     * Award XP and handle level ups
     */
    async awardXP(userId, guildId, xpAmount, source, user, member) {
        try {
            // Apply global multiplier
            const globalMultiplier = parseFloat(process.env.XP_MULTIPLIER) || 1.0;
            const finalXP = Math.round(xpAmount * globalMultiplier);

            // Update daily cap tracking
            await this.dailyCapManager.addXP(userId, guildId, finalXP, source);

            // Get current user data
            const { DatabaseManager } = require('../systems/DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            const currentData = await dbManager.getUserXP(userId, guildId);
            const oldLevel = currentData?.level || 0;

            // Update user XP
            const result = await dbManager.updateUserXP(userId, guildId, finalXP, source);
            if (!result) return;

            // Calculate new level
            const newLevel = this.levelCalculator.calculateLevel(result.total_xp);
            
            // Update level if changed
            if (newLevel !== oldLevel) {
                await dbManager.updateUserLevel(userId, guildId, newLevel);
                
                // Handle level up
                await this.levelUpHandler.handleLevelUp(
                    userId, guildId, oldLevel, newLevel, result.total_xp, user, member, source
                );
            }

            // Log XP activity
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
     * Start voice XP processing interval
     */
    startVoiceXPProcessing() {
        const interval = parseInt(process.env.VOICE_PROCESSING_INTERVAL) || 300000; // 5 minutes
        
        setInterval(() => {
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
            const { DatabaseManager } = require('../systems/DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            const userData = await dbManager.getUserXP(userId, guildId);
            if (!userData) return null;

            const rank = await dbManager.getUserRank(userId, guildId);
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
            const { DatabaseManager } = require('../systems/DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            const users = await dbManager.getLeaderboard(guildId, limit);
            
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
     * Cleanup
     */
    async cleanup() {
        try {
            console.log('🧹 Cleaning up XP Manager...');
            
            if (this.dailyCapManager) {
                await this.dailyCapManager.cleanup();
            }
            
            this.cooldowns.clear();
            console.log('✅ XP Manager cleanup complete');
        } catch (error) {
            console.error('Error during XP Manager cleanup:', error);
        }
    }
}

module.exports = XPManager;
