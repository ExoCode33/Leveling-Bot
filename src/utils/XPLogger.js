const { EmbedBuilder } = require('discord.js');

/**
 * XPLogger - Enhanced XP activity logging with batching and daily cap progression
 * NEW FEATURES: Batched voice logs per channel + Daily cap progress for all sources
 */
class XPLogger {
    constructor(client) {
        this.client = client;
        this.voiceLogBatch = new Map(); // Store voice activities for batching
        this.batchTimer = null;
        this.batchInterval = 30000; // 30 seconds
    }

    /**
     * Log XP activity with batching for voice and daily cap progression
     */
    async logXPActivity(type, user, guildId, xpGain, additionalInfo = {}) {
        try {
            // Check if logging is enabled for this type
            if (!this.isLoggingEnabled(type)) {
                return;
            }

            const channelId = process.env.XP_LOG_CHANNEL;
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            // Handle voice XP with batching
            if (type === 'voice') {
                await this.handleVoiceActivityBatching(user, guildId, xpGain, additionalInfo, channel);
                return;
            }

            // Handle other XP types immediately with daily cap progress
            const embed = await this.createEnhancedLogEmbed(type, user, guildId, xpGain, additionalInfo);
            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to send XP log:', error);
        }
    }

    /**
     * Handle voice activity batching by channel
     */
    async handleVoiceActivityBatching(user, guildId, xpGain, additionalInfo, channel) {
        const channelKey = `${guildId}-${additionalInfo.channelId || 'unknown'}`;
        
        // Initialize batch for this channel if it doesn't exist
        if (!this.voiceLogBatch.has(channelKey)) {
            this.voiceLogBatch.set(channelKey, {
                guildId: guildId,
                channelId: additionalInfo.channelId,
                channelName: additionalInfo.channelName || 'Unknown Channel',
                activities: [],
                totalXP: 0,
                startTime: new Date()
            });
        }

        const batch = this.voiceLogBatch.get(channelKey);
        
        // Add activity to batch
        batch.activities.push({
            user: user,
            xpGain: xpGain,
            totalXP: additionalInfo.totalXP,
            currentLevel: additionalInfo.currentLevel,
            member: additionalInfo.member
        });
        
        batch.totalXP += xpGain;

        // Start batch timer if not already running
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => {
                this.processBatchedVoiceLogs(channel);
            }, this.batchInterval);
        }
    }

    /**
     * Process and send batched voice logs
     */
    async processBatchedVoiceLogs(channel) {
        try {
            console.log(`[XP LOG] Processing ${this.voiceLogBatch.size} voice channel batches`);

            for (const [channelKey, batch] of this.voiceLogBatch.entries()) {
                if (batch.activities.length === 0) continue;

                const embed = await this.createBatchedVoiceEmbed(batch);
                await channel.send({ embeds: [embed] });
            }

            // Clear batch and timer
            this.voiceLogBatch.clear();
            this.batchTimer = null;

        } catch (error) {
            console.error('[XP LOG] Error processing batched voice logs:', error);
        }
    }

    /**
     * Create batched voice activity embed
     */
    async createBatchedVoiceEmbed(batch) {
        const guild = this.client.guilds.cache.get(batch.guildId);
        const duration = Math.round((new Date() - batch.startTime) / 1000);
        
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ 
                name: '🔴 MARINE INTELLIGENCE BUREAU'
            })
            .setTitle(`🎤 VOICE CHANNEL ACTIVITY REPORT`)
            .setDescription(`\`\`\`diff\n- SURVEILLANCE REPORT\n- LOCATION: ${batch.channelName}\n- GUILD: ${guild?.name || 'Unknown'}\n- DURATION: ${duration}s\n- TOTAL PARTICIPANTS: ${batch.activities.length}\n- COMBINED XP AWARDED: +${batch.totalXP.toLocaleString()}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: '⚓ Marine Intelligence Division • Voice Activity Monitor' });

        // Group activities by user to avoid spam
        const userActivities = new Map();
        
        for (const activity of batch.activities) {
            const userId = activity.user.id;
            if (!userActivities.has(userId)) {
                userActivities.set(userId, {
                    user: activity.user,
                    totalXP: 0,
                    sessions: 0,
                    finalLevel: activity.currentLevel,
                    finalTotalXP: activity.totalXP,
                    member: activity.member
                });
            }
            
            const userActivity = userActivities.get(userId);
            userActivity.totalXP += activity.xpGain;
            userActivity.sessions += 1;
            userActivity.finalLevel = activity.currentLevel; // Keep latest level
            userActivity.finalTotalXP = activity.totalXP; // Keep latest total
        }

        // Add participant details with daily cap progress
        let participantDetails = '';
        let participantCount = 0;

        for (const [userId, userActivity] of userActivities) {
            participantCount++;
            
            // Get daily cap progress for this user
            let dailyProgress = '';
            try {
                if (userActivity.member && this.client.xpManager?.dailyCapManager) {
                    const dailyStats = await this.client.xpManager.dailyCapManager.getDailyStats(userId, batch.guildId, userActivity.member);
                    const percentage = Math.min(100, dailyStats.percentage);
                    const progressBar = this.createProgressBar(dailyStats.totalXP, dailyStats.dailyCap, 10);
                    dailyProgress = `\n    Daily: ${dailyStats.totalXP.toLocaleString()}/${dailyStats.dailyCap.toLocaleString()} (${percentage}%) ${progressBar}`;
                }
            } catch (error) {
                // Silently handle errors
            }

            participantDetails += `**${userActivity.user.username}** (+${userActivity.totalXP} XP)\n`;
            participantDetails += `    Level: ${userActivity.finalLevel} | Total: ${userActivity.finalTotalXP.toLocaleString()}${dailyProgress}\n\n`;

            // Limit to prevent embed size issues
            if (participantCount >= 8) {
                const remaining = userActivities.size - participantCount;
                if (remaining > 0) {
                    participantDetails += `*...and ${remaining} more participants*`;
                }
                break;
            }
        }

        if (participantDetails) {
            embed.addFields({
                name: '👥 PARTICIPANT ACTIVITY',
                value: participantDetails.trim(),
                inline: false
            });
        }

        return embed;
    }

    /**
     * Create enhanced log embed with daily cap progression
     */
    async createEnhancedLogEmbed(type, user, guildId, xpGain, additionalInfo) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ 
                name: '🔴 MARINE INTELLIGENCE BUREAU',
                iconURL: user.displayAvatarURL({ size: 32 })
            })
            .setTimestamp()
            .setFooter({ text: '⚓ Marine Intelligence Division • Activity Monitor' });

        const guild = this.client.guilds.cache.get(guildId);

        // Base information
        let description = `\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- XP AWARDED: +${xpGain}\n- NEW TOTAL: ${this.formatNumber(additionalInfo.totalXP)}\n- CURRENT LEVEL: ${additionalInfo.currentLevel || 0}\n- SOURCE: ${type.toUpperCase()}\n\`\`\``;

        // Add daily cap progression
        try {
            if (additionalInfo.member && this.client.xpManager?.dailyCapManager) {
                const dailyStats = await this.client.xpManager.dailyCapManager.getDailyStats(user.id, guildId, additionalInfo.member);
                
                const progressBar = this.createProgressBar(dailyStats.totalXP, dailyStats.dailyCap, 20);
                const percentage = Math.min(100, dailyStats.percentage);
                
                // Determine tier info
                let tierInfo = 'Standard';
                if (dailyStats.tierLevel > 0) {
                    tierInfo = `Tier ${dailyStats.tierLevel}`;
                }

                embed.addFields({
                    name: '📊 DAILY PROGRESS',
                    value: `**Cap:** ${dailyStats.dailyCap.toLocaleString()} XP (${tierInfo})\n**Used:** ${dailyStats.totalXP.toLocaleString()} XP (${percentage}%)\n**Remaining:** ${dailyStats.remaining.toLocaleString()} XP\n\n${progressBar}`,
                    inline: false
                });

                // Add breakdown if available
                if (dailyStats.messageXP > 0 || dailyStats.voiceXP > 0 || dailyStats.reactionXP > 0) {
                    embed.addFields({
                        name: '📈 TODAY\'S SOURCES',
                        value: `💬 Messages: ${dailyStats.messageXP.toLocaleString()} XP\n🎤 Voice: ${dailyStats.voiceXP.toLocaleString()} XP\n👍 Reactions: ${dailyStats.reactionXP.toLocaleString()} XP`,
                        inline: true
                    });
                }

                // Add warning if near cap
                if (percentage >= 90) {
                    embed.addFields({
                        name: '⚠️ WARNING',
                        value: dailyStats.isAtCap ? 
                            '```diff\n- DAILY CAP REACHED\n- No more XP until reset\n```' : 
                            '```diff\n! APPROACHING DAILY CAP\n! Limited XP remaining\n```',
                        inline: false
                    });
                }
            }
        } catch (error) {
            console.error('[XP LOG] Error adding daily progress:', error);
        }

        // Set title based on type
        switch (type) {
            case 'message':
                embed.setTitle('💬 MESSAGE ACTIVITY DETECTED');
                break;
            case 'reaction':
                embed.setTitle('👍 REACTION ACTIVITY DETECTED');
                break;
            case 'levelup':
                embed.setTitle('⚠️ THREAT LEVEL INCREASED ⚠️');
                // Add level up specific info
                const oldLevel = additionalInfo.oldLevel || 0;
                const newLevel = additionalInfo.currentLevel || 0;
                
                if (oldLevel !== newLevel) {
                    const BountyCalculator = require('./BountyCalculator');
                    const bountyCalc = new BountyCalculator();
                    const oldBounty = bountyCalc.getBountyForLevel(oldLevel);
                    const newBounty = bountyCalc.getBountyForLevel(newLevel);
                    const bountyIncrease = newBounty - oldBounty;

                    description = `\`\`\`diff\n- BOUNTY UPDATE CONFIRMED\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- LEVEL PROGRESSION: ${oldLevel} → ${newLevel}\n- TOTAL XP: ${this.formatNumber(additionalInfo.totalXP)}\n- OLD BOUNTY: ฿${oldBounty.toLocaleString()}\n- NEW BOUNTY: ฿${newBounty.toLocaleString()}\n- BOUNTY INCREASE: +฿${bountyIncrease.toLocaleString()}\n- XP SOURCE: ${(additionalInfo.source || 'unknown').toUpperCase()}\n\`\`\``;
                }
                break;
            default:
                embed.setTitle(`${type.toUpperCase()} ACTIVITY DETECTED`);
                break;
        }

        embed.setDescription(description);
        return embed;
    }

    /**
     * Check if logging is enabled for specific type
     */
    isLoggingEnabled(type) {
        if (process.env.XP_LOG_ENABLED !== 'true') {
            return false;
        }

        const typeSettings = {
            message: process.env.XP_LOG_MESSAGES === 'true',
            voice: process.env.XP_LOG_VOICE === 'true',
            reaction: process.env.XP_LOG_REACTIONS === 'true',
            levelup: process.env.XP_LOG_LEVELUP === 'true'
        };

        return typeSettings[type] || false;
    }

    /**
     * Format number for display
     */
    formatNumber(num) {
        if (num === undefined || num === null) return '0';
        return num.toLocaleString();
    }

    /**
     * Create progress bar for display
     */
    createProgressBar(current, max, length = 20) {
        if (max === 0) return '░'.repeat(length);
        
        const percentage = Math.max(0, Math.min(1, current / max));
        const filled = Math.round(percentage * length);
        const empty = length - filled;
        
        const filledChar = '█';
        const emptyChar = '░';
        
        return filledChar.repeat(filled) + emptyChar.repeat(empty);
    }

    /**
     * Log daily cap reached event
     */
    async logDailyCapReached(user, guildId, capAmount, capType = 'Standard') {
        try {
            if (!this.isLoggingEnabled('voice')) return;

            const channelId = process.env.XP_LOG_CHANNEL;
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const guild = this.client.guilds.cache.get(guildId);

            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setAuthor({ 
                    name: '🚨 MARINE INTELLIGENCE BUREAU',
                    iconURL: user.displayAvatarURL({ size: 32 })
                })
                .setTitle('🚨 DAILY XP CAP REACHED')
                .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- CAP REACHED: ${capAmount.toLocaleString()} XP\n- CAP TYPE: ${capType}\n- STATUS: No more XP can be gained today\n- NEXT RESET: Check daily stats\n\`\`\``)
                .setTimestamp()
                .setFooter({ text: '⚓ Marine Intelligence Division • Daily Cap System' });

            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to log daily cap reached:', error);
        }
    }

    /**
     * Log admin XP modification
     */
    async logAdminXPModification(adminUser, targetUser, guildId, xpChange, reason, newTotal, newLevel) {
        try {
            const channelId = process.env.XP_LOG_CHANNEL;
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const guild = this.client.guilds.cache.get(guildId);

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setAuthor({ 
                    name: '⚓ MARINE COMMAND CENTER',
                    iconURL: adminUser.displayAvatarURL({ size: 32 })
                })
                .setTitle('🔴 MANUAL XP ADJUSTMENT')
                .setDescription(`\`\`\`diff\n- ADMINISTRATIVE ACTION\n- TARGET: ${targetUser.username} (${targetUser.id})\n- AUTHORIZED BY: ${adminUser.username} (${adminUser.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- XP ADJUSTMENT: ${xpChange >= 0 ? '+' : ''}${xpChange}\n- NEW TOTAL: ${newTotal.toLocaleString()}\n- NEW LEVEL: ${newLevel}\n- REASON: ${reason}\n- SOURCE: ADMIN COMMAND\n\`\`\``)
                .setTimestamp()
                .setFooter({ text: '⚓ Marine Command Center • Administrative Action' });

            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to log admin XP modification:', error);
        }
    }

    /**
     * Log daily reset event
     */
    async logDailyReset(guildId, resetStats = {}) {
        try {
            if (process.env.XP_LOG_ENABLED !== 'true') return;

            const channelId = process.env.XP_LOG_CHANNEL;
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const guild = this.client.guilds.cache.get(guildId);
            const resetTime = new Date().toLocaleString('en-US', { 
                timeZone: 'America/New_York',
                hour12: false 
            });

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🌅 DAILY XP RESET COMPLETE')
                .setDescription(`\`\`\`diff\n+ Daily XP caps have been reset\n+ All users can now gain XP again\n+ Reset Time: ${resetTime} EDT\n+ Guild: ${guild?.name || 'Unknown'}\n${resetStats.affectedUsers ? `+ Users Affected: ${resetStats.affectedUsers}\n` : ''}\`\`\``)
                .setTimestamp()
                .setFooter({ text: '⚓ Marine Intelligence Division • Daily Reset System' });

            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to log daily reset:', error);
        }
    }

    /**
     * Force process any pending batched voice logs
     */
    async forceProcessBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        if (this.voiceLogBatch.size > 0) {
            const channelId = process.env.XP_LOG_CHANNEL;
            if (channelId) {
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                if (channel) {
                    await this.processBatchedVoiceLogs(channel);
                }
            }
        }
    }

    /**
     * Get logging configuration
     */
    getLoggingConfig() {
        return {
            enabled: process.env.XP_LOG_ENABLED === 'true',
            channel: process.env.XP_LOG_CHANNEL || null,
            batchInterval: this.batchInterval / 1000, // Convert to seconds for display
            types: {
                messages: process.env.XP_LOG_MESSAGES === 'true',
                voice: process.env.XP_LOG_VOICE === 'true',
                reactions: process.env.XP_LOG_REACTIONS === 'true',
                levelup: process.env.XP_LOG_LEVELUP === 'true'
            }
        };
    }

    /**
     * Cleanup on shutdown
     */
    async cleanup() {
        console.log('[XP LOG] Processing final batched logs...');
        await this.forceProcessBatch();
        console.log('[XP LOG] Cleanup complete');
    }
}

module.exports = XPLogger;
