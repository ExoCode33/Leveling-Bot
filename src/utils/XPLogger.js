const { EmbedBuilder } = require('discord.js');

/**
 * XPLogger - Handles XP activity logging to designated channels
 */
class XPLogger {
    constructor(client) {
        this.client = client;
    }

    /**
     * Log XP activity
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

            const embed = this.createLogEmbed(type, user, guildId, xpGain, additionalInfo);
            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to send XP log:', error);
        }
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
     * Create log embed based on type
     */
    createLogEmbed(type, user, guildId, xpGain, additionalInfo) {
        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ 
                name: '🔴 MARINE INTELLIGENCE BUREAU',
                iconURL: user.displayAvatarURL({ size: 32 })
            })
            .setTimestamp()
            .setFooter({ text: '⚓ Marine Intelligence Division • Activity Monitor' });

        switch (type) {
            case 'message':
                return this.createMessageLogEmbed(embed, user, guildId, xpGain, additionalInfo);
            case 'voice':
                return this.createVoiceLogEmbed(embed, user, guildId, xpGain, additionalInfo);
            case 'reaction':
                return this.createReactionLogEmbed(embed, user, guildId, xpGain, additionalInfo);
            case 'levelup':
                return this.createLevelUpLogEmbed(embed, user, guildId, xpGain, additionalInfo);
            default:
                return this.createGenericLogEmbed(embed, type, user, guildId, xpGain, additionalInfo);
        }
    }

    /**
     * Create message activity log embed
     */
    createMessageLogEmbed(embed, user, guildId, xpGain, info) {
        const guild = this.client.guilds.cache.get(guildId);
        
        return embed
            .setTitle('💬 MESSAGE ACTIVITY DETECTED')
            .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- XP AWARDED: +${xpGain}\n- NEW TOTAL: ${this.formatNumber(info.totalXP)}\n- CURRENT LEVEL: ${info.currentLevel || 0}\n- SOURCE: MESSAGE ACTIVITY\n\`\`\``);
    }

    /**
     * Create voice activity log embed
     */
    createVoiceLogEmbed(embed, user, guildId, xpGain, info) {
        const guild = this.client.guilds.cache.get(guildId);
        
        // Get daily cap information if available
        let dailyCapInfo = '';
        if (info.dailyStats) {
            const stats = info.dailyStats;
            const percentage = Math.round((stats.totalXP / stats.dailyCap) * 100);
            dailyCapInfo = `\n- DAILY XP: ${stats.totalXP.toLocaleString()}/${stats.dailyCap.toLocaleString()} (${percentage}%)\n- REMAINING: ${stats.remaining.toLocaleString()} XP`;
        }
        
        return embed
            .setTitle('🎤 VOICE ACTIVITY DETECTED')
            .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- VOICE CHANNEL: ${info.channelName || 'Unknown'}\n- XP AWARDED: +${xpGain}\n- NEW TOTAL: ${this.formatNumber(info.totalXP)}\n- CURRENT LEVEL: ${info.currentLevel || 0}${dailyCapInfo}\n- SOURCE: VOICE ACTIVITY\n\`\`\``);
    }

    /**
     * Create reaction activity log embed
     */
    createReactionLogEmbed(embed, user, guildId, xpGain, info) {
        const guild = this.client.guilds.cache.get(guildId);
        
        return embed
            .setTitle('👍 REACTION ACTIVITY DETECTED')
            .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- XP AWARDED: +${xpGain}\n- NEW TOTAL: ${this.formatNumber(info.totalXP)}\n- CURRENT LEVEL: ${info.currentLevel || 0}\n- SOURCE: REACTION ACTIVITY\n\`\`\``);
    }

    /**
     * Create level up log embed
     */
    createLevelUpLogEmbed(embed, user, guildId, xpGain, info) {
        const guild = this.client.guilds.cache.get(guildId);
        const BountyCalculator = require('./BountyCalculator');
        const bountyCalc = new BountyCalculator();
        
        const oldLevel = info.oldLevel || 0;
        const newLevel = info.currentLevel || 0;
        const oldBounty = bountyCalc.getBountyForLevel(oldLevel);
        const newBounty = bountyCalc.getBountyForLevel(newLevel);
        const bountyIncrease = newBounty - oldBounty;
        
        return embed
            .setTitle('⚠️ THREAT LEVEL INCREASED ⚠️')
            .setDescription(`\`\`\`diff\n- BOUNTY UPDATE CONFIRMED\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- LEVEL PROGRESSION: ${oldLevel} → ${newLevel}\n- TOTAL XP: ${this.formatNumber(info.totalXP)}\n- OLD BOUNTY: ฿${oldBounty.toLocaleString()}\n- NEW BOUNTY: ฿${newBounty.toLocaleString()}\n- BOUNTY INCREASE: +฿${bountyIncrease.toLocaleString()}\n- XP SOURCE: ${(info.source || 'unknown').toUpperCase()}\n${info.roleReward ? `- ROLE AWARDED: ${info.roleReward}\n` : ''}\`\`\``);
    }

    /**
     * Create generic activity log embed
     */
    createGenericLogEmbed(embed, type, user, guildId, xpGain, info) {
        const guild = this.client.guilds.cache.get(guildId);
        
        return embed
            .setTitle(`${type.toUpperCase()} ACTIVITY DETECTED`)
            .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- XP AWARDED: +${xpGain}\n- NEW TOTAL: ${this.formatNumber(info.totalXP)}\n- CURRENT LEVEL: ${info.currentLevel || 0}\n- SOURCE: ${type.toUpperCase()}\n\`\`\``);
    }

    /**
     * Format number for display
     */
    formatNumber(num) {
        if (num === undefined || num === null) return '0';
        return num.toLocaleString();
    }

    /**
     * Create progress bar for logging
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
                .setDescription(`\`\`\`diff\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- CAP REACHED: ${capAmount.toLocaleString()} XP\n- CAP TYPE: ${capType}\n- STATUS: No more XP can be gained today\n- NEXT RESET: Check /daily-stats\n\`\`\``)
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
     * Get logging configuration
     */
    getLoggingConfig() {
        return {
            enabled: process.env.XP_LOG_ENABLED === 'true',
            channel: process.env.XP_LOG_CHANNEL || null,
            types: {
                messages: process.env.XP_LOG_MESSAGES === 'true',
                voice: process.env.XP_LOG_VOICE === 'true',
                reactions: process.env.XP_LOG_REACTIONS === 'true',
                levelup: process.env.XP_LOG_LEVELUP === 'true'
            }
        };
    }
}

module.exports = XPLogger;
