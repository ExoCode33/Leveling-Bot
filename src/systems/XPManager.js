const DatabaseManager = require('./DatabaseManager');
const BountyCalculator = require('../utils/BountyCalculator');
const LevelCalculator = require('../utils/LevelCalculator');
const DailyCapManager = require('./DailyCapManager');
const LevelUpHandler = require('./LevelUpHandler');
const XPLogger = require('../utils/XPLogger');

/**
 * XPManager - Main XP tracking and management system
 * FIXED VERSION - Properly enforces daily caps and prevents exceeding them
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
        
        // Track voice processing state
        this.isProcessingVoice = false;
        this.voiceProcessingInterval = null;
    }

    /**
     * Initialize the XP manager - FIXED VERSION
     */
    async initialize() {
        try {
            console.log('⚡ Initializing XP Manager...');
            
            // Initialize daily cap manager
            await this.dailyCapManager.initialize();
            
            // Clean up any existing orphaned sessions first
            await this.cleanupOrphanedVoiceSessions();
            
            // Wait for client to be fully ready before syncing
            if (this.client.isReady()) {
                await this.syncExistingVoiceSessions();
            } else {
                // Wait for ready event
                this.client.once('ready', async () => {
                    console.log('🎤 [VOICE SYNC] Client ready, starting voice session sync...');
                    await this.syncExistingVoiceSessions();
                });
            }
            
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
     * Sync existing voice sessions on bot startup - COMPLETELY REWRITTEN AND FIXED
     */
    async syncExistingVoiceSessions() {
        try {
            console.log('🎤 [VOICE SYNC] ==================== STARTING VOICE SYNC ====================');
            console.log(`🎤 [VOICE SYNC] Bot connected to ${this.client.guilds.cache.size} guilds`);
            console.log(`🎤 [VOICE SYNC] Bot ready state: ${this.client.isReady()}`);
            
            let totalSynced = 0;
            let totalIgnored = 0;
            let totalErrors = 0;
            
            // Process each guild
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    console.log(`🎤 [VOICE SYNC] === Processing guild: ${guild.name} (${guildId}) ===`);
                    
                    // Get all voice channels in this guild
                    const voiceChannels = guild.channels.cache.filter(channel => 
                        channel.type === 2 && // GUILD_VOICE = 2
                        channel.members && 
                        channel.members.size > 0
                    );
                    
                    console.log(`🎤 [VOICE SYNC] Found ${voiceChannels.size} non-empty voice channels`);
                    
                    if (voiceChannels.size === 0) {
                        console.log(`🎤 [VOICE SYNC] No active voice channels in ${guild.name}, skipping`);
                        continue;
                    }
                    
                    // Process each voice channel with members
                    for (const [channelId, channel] of voiceChannels) {
                        console.log(`🎤 [VOICE SYNC] --- Processing channel: ${channel.name} (${channelId}) ---`);
                        console.log(`🎤 [VOICE SYNC] Channel has ${channel.members.size} total members`);
                        
                        // Get only human members (filter out bots)
                        const humanMembers = channel.members.filter(member => !member.user.bot);
                        console.log(`🎤 [VOICE SYNC] Channel has ${humanMembers.size} human members`);
                        
                        if (humanMembers.size === 0) {
                            console.log(`🎤 [VOICE SYNC] No human members in ${channel.name}, skipping`);
                            continue;
                        }
                        
                        // Process each human member
                        for (const [userId, member] of humanMembers) {
                            try {
                                console.log(`🎤 [VOICE SYNC] Processing member: ${member.user.username} (${userId})`);
                                
                                // Double-check voice state
                                const voiceState = member.voice;
                                if (!voiceState || voiceState.channelId !== channelId) {
                                    console.log(`🎤 [VOICE SYNC] ❌ ${member.user.username} voice state mismatch, skipping`);
                                    continue;
                                }
                                
                                console.log(`🎤 [VOICE SYNC] Voice state: muted=${voiceState.mute || voiceState.selfMute}, deafened=${voiceState.deaf || voiceState.selfDeaf}`);
                                
                                // Create voice session with adjusted timing for immediate XP processing
                                const cooldownMs = parseInt(process.env.VOICE_COOLDOWN) || 300000; // 5 minutes
                                const adjustedTime = new Date(Date.now() - cooldownMs - 10000); // Extra 10 seconds buffer
                                
                                console.log(`🎤 [VOICE SYNC] Setting session time to: ${adjustedTime.toISOString()}`);
                                
                                const result = await this.dbManager.setVoiceSessionWithTime(
                                    userId,
                                    guildId,
                                    channelId,
                                    voiceState.mute || voiceState.selfMute || false,
                                    voiceState.deaf || voiceState.selfDeaf || false,
                                    adjustedTime
                                );
                                
                                if (result) {
                                    totalSynced++;
                                    console.log(`🎤 [VOICE SYNC] ✅ Successfully synced: ${member.user.username}`);
                                } else {
                                    console.log(`🎤 [VOICE SYNC] ❌ Failed to sync: ${member.user.username}`);
                                    totalErrors++;
                                }
                                
                            } catch (memberError) {
                                console.error(`🎤 [VOICE SYNC] ❌ Error processing member ${userId}:`, memberError);
                                totalErrors++;
                            }
                        }
                    }
                    
                } catch (guildError) {
                    console.error(`🎤 [VOICE SYNC] ❌ Error processing guild ${guild.name}:`, guildError);
                    totalErrors++;
                }
            }
            
            console.log(`🎤 [VOICE SYNC] ==================== SYNC COMPLETE ====================`);
            console.log(`🎤 [VOICE SYNC] ✅ Users synced: ${totalSynced}`);
            console.log(`🎤 [VOICE SYNC] ❌ Bots ignored: ${totalIgnored}`);
            console.log(`🎤 [VOICE SYNC] ⚠️ Errors: ${totalErrors}`);
            
            // Immediately process XP for synced sessions if any
            if (totalSynced > 0) {
                console.log(`🎤 [VOICE SYNC] Scheduling immediate XP processing for ${totalSynced} users in 10 seconds...`);
                setTimeout(async () => {
                    console.log(`🎤 [VOICE SYNC] ⚡ Triggering immediate XP processing...`);
                    await this.processVoiceXP();
                }, 10000);
            }
            
        } catch (error) {
            console.error('❌ Critical error in voice session sync:', error);
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

            // Check daily cap BEFORE calculating XP
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
            
            const calculatedXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            // ENFORCE DAILY CAP: Only award XP up to the remaining cap amount
            const finalXP = Math.min(calculatedXP, canGainXP.remaining);

            // Only award if there's XP to award
            if (finalXP > 0) {
                await this.awardXP(userId, guildId, finalXP, 'message', message.author, member, null);
                
                // Set cooldown
                this.setCooldown(cooldownKey);
            }

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

            // Check daily cap BEFORE calculating XP
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
            
            const calculatedXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            // ENFORCE DAILY CAP: Only award XP up to the remaining cap amount
            const finalXP = Math.min(calculatedXP, canGainXP.remaining);

            // Only award if there's XP to award
            if (finalXP > 0) {
                await this.awardXP(userId, guildId, finalXP, 'reaction', user, member, null);
                
                // Set cooldown
                this.setCooldown(cooldownKey);
            }

        } catch (error) {
            console.error('Error handling reaction XP:', error);
        }
    }

    /**
     * Handle voice state updates - FIXED WITH PROPER BOT FILTERING
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
            
            // CRITICAL: IGNORE BOTS
            if (member.user.bot) {
                console.log(`🎤 [VOICE] Ignoring bot voice state change: ${member.user.username}`);
                return;
            }

            console.log(`🎤 [VOICE] Processing voice state update for ${member.user.username}`);
            console.log(`🎤 [VOICE] Old channel: ${oldState.channelId}, New channel: ${newState.channelId}`);

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
                
                // If moved channels, reset the session
                if (oldState.channelId !== newState.channelId) {
                    console.log(`🎤 [VOICE] ${member.user.username} moved to ${newState.channel.name}`);
                    
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
     * Process voice XP for all active sessions - COMPLETELY REWRITTEN
     */
    async processVoiceXP() {
        // Prevent multiple simultaneous voice processing
        if (this.isProcessingVoice) {
            console.log(`🎤 [VOICE DEBUG] Voice XP processing already in progress, skipping...`);
            return;
        }

        this.isProcessingVoice = true;
        
        try {
            console.log(`🎤 [VOICE DEBUG] ================ STARTING VOICE XP PROCESSING ================`);
            
            let totalSessionsChecked = 0;
            let totalXPAwarded = 0;
            let totalUsersAwarded = 0;
            let totalSessionsRemoved = 0;
            
            // Process each guild
            for (const [guildId, guild] of this.client.guilds.cache) {
                const sessions = await this.dbManager.getVoiceSessions(guildId);
                console.log(`🎤 [VOICE DEBUG] Guild ${guild.name}: Processing ${sessions.length} voice sessions`);
                
                if (sessions.length === 0) continue;
                
                for (const session of sessions) {
                    totalSessionsChecked++;
                    const result = await this.processUserVoiceXP(session, guild);
                    
                    if (result.xpAwarded > 0) {
                        totalXPAwarded += result.xpAwarded;
                        totalUsersAwarded++;
                        console.log(`🎤 [VOICE DEBUG] ✅ Awarded ${result.xpAwarded} XP to user ${session.user_id}`);
                    } else if (result.reason === 'session_removed') {
                        totalSessionsRemoved++;
                        console.log(`🎤 [VOICE DEBUG] 🗑️ Removed invalid session for user ${session.user_id}: ${result.reason}`);
                    } else {
                        console.log(`🎤 [VOICE DEBUG] ❌ No XP for user ${session.user_id}: ${result.reason}`);
                    }
                }
            }
            
            console.log(`🎤 [VOICE DEBUG] ================ VOICE XP PROCESSING COMPLETE ================`);
            console.log(`🎤 [VOICE DEBUG] Sessions checked: ${totalSessionsChecked}`);
            console.log(`🎤 [VOICE DEBUG] Users awarded XP: ${totalUsersAwarded}`);
            console.log(`🎤 [VOICE DEBUG] Total XP awarded: ${totalXPAwarded}`);
            console.log(`🎤 [VOICE DEBUG] Invalid sessions removed: ${totalSessionsRemoved}`);
            
        } catch (error) {
            console.error('🎤 [VOICE DEBUG] ❌ Critical error in voice XP processing:', error);
        } finally {
            this.isProcessingVoice = false;
        }
    }

    /**
     * Process voice XP for individual user - COMPLETELY REWRITTEN WITH BETTER VALIDATION
     */
    async processUserVoiceXP(session, guild) {
        try {
            const now = Date.now();
            const cooldownMs = parseInt(process.env.VOICE_COOLDOWN) || 300000; // 5 minutes
            const minMembers = parseInt(process.env.VOICE_MIN_MEMBERS) || 2;
            const antiAFK = process.env.VOICE_ANTI_AFK === 'true';
            
            console.log(`🎤 [VOICE USER] Processing user ${session.user_id} in channel ${session.channel_id}`);
            
            // Validate session timing
            const lastXPTime = new Date(session.last_xp_time).getTime();
            const timeSinceLastXP = now - lastXPTime;
            
            console.log(`🎤 [VOICE USER] Time since last XP: ${Math.round(timeSinceLastXP/1000)}s (required: ${cooldownMs/1000}s)`);
            
            if (timeSinceLastXP < cooldownMs) {
                return { xpAwarded: 0, reason: 'cooldown_not_met' };
            }

            // Validate channel still exists and get current members
            const channel = guild.channels.cache.get(session.channel_id);
            if (!channel || channel.type !== 2) {
                console.log(`🎤 [VOICE USER] Channel ${session.channel_id} no longer exists or not voice channel, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'session_removed' };
            }

            // Get member and validate they exist and are not a bot
            const member = await guild.members.fetch(session.user_id).catch(() => null);
            if (!member) {
                console.log(`🎤 [VOICE USER] Member ${session.user_id} no longer in guild, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'session_removed' };
            }

            // CRITICAL: Double-check not a bot
            if (member.user.bot) {
                console.log(`🎤 [VOICE USER] ⚠️ Found bot in voice sessions, removing: ${member.user.username}`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'session_removed' };
            }

            // Validate member is actually in the expected voice channel
            const memberVoiceState = member.voice;
            if (!memberVoiceState.channelId) {
                console.log(`🎤 [VOICE USER] Member ${member.user.username} not in any voice channel, removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'session_removed' };
            }

            if (memberVoiceState.channelId !== session.channel_id) {
                console.log(`🎤 [VOICE USER] Member ${member.user.username} in different channel (${memberVoiceState.channelId} vs ${session.channel_id}), removing session`);
                await this.dbManager.removeVoiceSession(session.user_id, session.guild_id);
                return { xpAwarded: 0, reason: 'session_removed' };
            }

            // Count human members in channel (exclude bots)
            const humanMembers = channel.members.filter(m => !m.user.bot);
            const memberCount = humanMembers.size;
            console.log(`🎤 [VOICE USER] Channel ${channel.name}: ${memberCount} human members (${channel.members.size} total with bots)`);
            
            if (memberCount < minMembers) {
                console.log(`🎤 [VOICE USER] Not enough human members (${memberCount}/${minMembers}), no XP awarded`);
                return { xpAwarded: 0, reason: 'insufficient_human_members' };
            }

            // Check daily cap BEFORE calculating XP
            const canGainXP = await this.dailyCapManager.canGainXP(session.user_id, session.guild_id, member);
            if (!canGainXP.allowed) {
                console.log(`🎤 [VOICE USER] ${member.user.username} has reached daily XP cap (${canGainXP.currentXP}/${canGainXP.dailyCap})`);
                return { xpAwarded: 0, reason: 'daily_cap_reached' };
            }

            // Calculate XP with all modifiers
            const guildSettings = await this.dbManager.getGuildSettings(session.guild_id);
            const minXP = guildSettings?.voice_xp_min || parseInt(process.env.VOICE_XP_MIN) || 250;
            const maxXP = guildSettings?.voice_xp_max || parseInt(process.env.VOICE_XP_MAX) || 350;
            let baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;

            console.log(`🎤 [VOICE USER] Base XP calculated: ${baseXP} (range: ${minXP}-${maxXP})`);

            // Apply AFK penalty if enabled and user is muted/deafened
            if (antiAFK && (memberVoiceState.mute || memberVoiceState.selfMute || memberVoiceState.deaf || memberVoiceState.selfDeaf)) {
                const exemptUsers = (process.env.VOICE_MUTE_EXEMPT_USERS || '').split(',').filter(id => id.trim());
                const exemptRoles = (process.env.VOICE_MUTE_EXEMPT_ROLES || '').split(',').filter(id => id.trim());
                const exemptMultiplier = parseFloat(process.env.VOICE_MUTE_EXEMPT_MULTIPLIER) || 1.0;
                
                let isExempt = false;
                
                // Check user exemption
                if (exemptUsers.includes(session.user_id)) {
                    isExempt = true;
                    baseXP = Math.round(baseXP * exemptMultiplier);
                    console.log(`🎤 [VOICE USER] User exempt from AFK penalty, XP: ${baseXP}`);
                }
                
                // Check role exemption
                if (!isExempt && exemptRoles.length > 0) {
                    for (const roleId of exemptRoles) {
                        if (member.roles.cache.has(roleId.trim())) {
                            isExempt = true;
                            baseXP = Math.round(baseXP * exemptMultiplier);
                            console.log(`🎤 [VOICE USER] Role exempt from AFK penalty, XP: ${baseXP}`);
                            break;
                        }
                    }
                }
                
                // Apply penalty if not exempt
                if (!isExempt) {
                    baseXP = Math.round(baseXP * 0.25); // 25% XP when muted/deafened
                    console.log(`🎤 [VOICE USER] AFK penalty applied (muted/deafened), XP reduced to: ${baseXP}`);
                }
            }

            // Apply multipliers
            const tierMultiplier = await this.getTierMultiplier(member);
            const guildMultiplier = guildSettings?.xp_multiplier || 1.0;
            const calculatedXP = Math.round(baseXP * tierMultiplier * guildMultiplier);

            // ENFORCE DAILY CAP: Only award XP up to the remaining cap amount
            const finalXP = Math.min(calculatedXP, canGainXP.remaining);

            console.log(`🎤 [VOICE USER] Calculated XP: ${calculatedXP}, Final XP (after cap): ${finalXP} (remaining: ${canGainXP.remaining})`);

            // Only award if there's XP to award
            if (finalXP > 0) {
                // Award XP with channel information
                await this.awardXP(
                    session.user_id, 
                    session.guild_id, 
                    finalXP, 
                    'voice', 
                    member.user, 
                    member,
                    {
                        name: channel.name,
                        id: channel.id
                    }
                );

                // Update session last XP time (this updates both is_muted and is_deafened from current voice state)
                await this.dbManager.updateVoiceSession(
                    session.user_id, 
                    session.guild_id, 
                    memberVoiceState.mute || memberVoiceState.selfMute || false,
                    memberVoiceState.deaf || memberVoiceState.selfDeaf || false
                );

                console.log(`🎤 [VOICE USER] ✅ Successfully awarded ${finalXP} XP to ${member.user.username}`);
                return { xpAwarded: finalXP, reason: 'success' };
            } else {
                console.log(`🎤 [VOICE USER] ❌ No XP to award (would exceed daily cap)`);
                return { xpAwarded: 0, reason: 'daily_cap_would_exceed' };
            }

        } catch (error) {
            console.error(`🎤 [VOICE USER] ❌ Error processing voice XP for ${session.user_id}:`, error);
            return { xpAwarded: 0, reason: 'error' };
        }
    }

    /**
     * Award XP and handle level ups - FIXED VERSION WITH PROPER CHANNEL LOGGING
     */
    async awardXP(userId, guildId, xpAmount, source, user, member, channelInfo = null) {
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

            // Prepare additional info for logging
            const additionalInfo = {
                totalXP: result.total_xp,
                currentLevel: newLevel,
                oldLevel: oldLevel,
                source: source,
                member: member
            };

            // Add channel information for voice activities
            if (source === 'voice' && channelInfo) {
                additionalInfo.channelName = channelInfo.name;
                additionalInfo.channelId = channelInfo.id;
            }

            // Log XP activity with proper channel info
            await this.xpLogger.logXPActivity(source, user, guildId, finalXP, additionalInfo);

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
     * Start voice XP processing interval - IMPROVED VERSION
     */
    startVoiceXPProcessing() {
        const interval = parseInt(process.env.VOICE_PROCESSING_INTERVAL) || 300000; // 5 minutes
        
        console.log(`🎤 Starting voice XP processing with ${interval / 1000}s intervals`);
        
        // Process immediately after a short delay to handle synced sessions
        setTimeout(() => {
            console.log(`🎤 [VOICE DEBUG] Initial voice XP processing (startup)`);
            this.processVoiceXP().catch(console.error);
        }, 15000); // 15 seconds after startup
        
        // Set up regular interval
        this.voiceProcessingInterval = setInterval(() => {
            console.log(`🎤 [VOICE DEBUG] Regular voice XP processing interval triggered`);
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
     * Get current user stats with daily information
     */
    async getUserStats(userId, guildId) {
        try {
            const userData = await this.dbManager.getUserXP(userId, guildId);
            if (!userData) return null;

            const rank = await this.dbManager.getUserRank(userId, guildId);
            const bounty = this.bountyCalculator.getBountyForLevel(userData.level);
            
            // Get member for tier information
            let member = null;
            try {
                const guild = this.client.guilds.cache.get(guildId);
                if (guild) {
                    member = await guild.members.fetch(userId);
                }
            } catch (error) {
                console.log('Could not fetch member for stats');
            }

            // Get daily stats
            const dailyStats = await this.dailyCapManager.getDailyStats(userId, guildId, member);
            
            return {
                ...userData,
                rank,
                bounty,
                dailyStats
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
     * Cleanup orphaned voice sessions on startup - IMPROVED VERSION
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
     * Force process voice XP for all sessions (manual trigger)
     */
    async forceProcessVoiceXP() {
        console.log('🎤 [MANUAL] Force processing voice XP...');
        await this.processVoiceXP();
        console.log('🎤 [MANUAL] Force voice XP processing complete');
    }

    /**
     * Get voice session statistics
     */
    async getVoiceSessionStats() {
        try {
            const stats = {
                totalSessions: 0,
                sessionsByGuild: new Map(),
                sessionsByChannel: new Map(),
                humanSessions: 0,
                botSessions: 0
            };

            for (const [guildId, guild] of this.client.guilds.cache) {
                const sessions = await this.dbManager.getVoiceSessions(guildId);
                stats.totalSessions += sessions.length;
                stats.sessionsByGuild.set(guild.name, sessions.length);

                for (const session of sessions) {
                    const member = await guild.members.fetch(session.user_id).catch(() => null);
                    if (member) {
                        if (member.user.bot) {
                            stats.botSessions++;
                        } else {
                            stats.humanSessions++;
                        }

                        const channel = guild.channels.cache.get(session.channel_id);
                        if (channel) {
                            const key = `${guild.name}/#${channel.name}`;
                            stats.sessionsByChannel.set(key, (stats.sessionsByChannel.get(key) || 0) + 1);
                        }
                    }
                }
            }

            return stats;
        } catch (error) {
            console.error('Error getting voice session stats:', error);
            return null;
        }
    }

    /**
     * Debug: List all current voice sessions
     */
    async debugListVoiceSessions() {
        console.log('🔍 [DEBUG] ================ CURRENT VOICE SESSIONS ================');
        
        for (const [guildId, guild] of this.client.guilds.cache) {
            const sessions = await this.dbManager.getVoiceSessions(guildId);
            console.log(`🔍 [DEBUG] Guild ${guild.name} (${guildId}): ${sessions.length} sessions`);
            
            for (const session of sessions) {
                const member = await guild.members.fetch(session.user_id).catch(() => null);
                const channel = guild.channels.cache.get(session.channel_id);
                
                console.log(`🔍 [DEBUG]   User: ${member?.user.username || 'Unknown'} (${session.user_id})`);
                console.log(`🔍 [DEBUG]   Channel: ${channel?.name || 'Unknown'} (${session.channel_id})`);
                console.log(`🔍 [DEBUG]   Join Time: ${session.join_time}`);
                console.log(`🔍 [DEBUG]   Last XP: ${session.last_xp_time}`);
                console.log(`🔍 [DEBUG]   Muted: ${session.is_muted}, Deafened: ${session.is_deafened}`);
                console.log(`🔍 [DEBUG]   Is Bot: ${member?.user.bot || 'Unknown'}`);
                console.log(`🔍 [DEBUG]   In Channel: ${member?.voice.channelId === session.channel_id}`);
                console.log(`🔍 [DEBUG]   ---`);
            }
        }
        
        console.log('🔍 [DEBUG] ================ END VOICE SESSIONS ================');
    }

    /**
     * Debug: List all users currently in voice channels
     */
    async debugListVoiceUsers() {
        console.log('🔍 [DEBUG] ================ USERS IN VOICE CHANNELS ================');
        
        for (const [guildId, guild] of this.client.guilds.cache) {
            console.log(`🔍 [DEBUG] Guild ${guild.name} (${guildId}):`);
            
            const voiceChannels = guild.channels.cache.filter(channel => 
                channel.type === 2 && channel.members && channel.members.size > 0
            );
            
            if (voiceChannels.size === 0) {
                console.log(`🔍 [DEBUG]   No active voice channels`);
                continue;
            }
            
            for (const [channelId, channel] of voiceChannels) {
                console.log(`🔍 [DEBUG]   Channel: ${channel.name} (${channelId}) - ${channel.members.size} members`);
                
                for (const [userId, member] of channel.members) {
                    console.log(`🔍 [DEBUG]     ${member.user.username} (${userId}) - Bot: ${member.user.bot}`);
                    console.log(`🔍 [DEBUG]       Voice State: muted=${member.voice.mute || member.voice.selfMute}, deafened=${member.voice.deaf || member.voice.selfDeaf}`);
                }
            }
        }
        
        console.log('🔍 [DEBUG] ================ END VOICE USERS ================');
    }

    /**
     * Cleanup - IMPROVED VERSION
     */
    async cleanup() {
        try {
            console.log('🧹 Cleaning up XP Manager...');
            
            // Clear voice processing interval
            if (this.voiceProcessingInterval) {
                clearInterval(this.voiceProcessingInterval);
                this.voiceProcessingInterval = null;
                console.log('🧹 Cleared voice processing interval');
            }
            
            // Wait for any ongoing voice processing to complete
            let attempts = 0;
            while (this.isProcessingVoice && attempts < 10) {
                console.log('🧹 Waiting for voice processing to complete...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
            
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
