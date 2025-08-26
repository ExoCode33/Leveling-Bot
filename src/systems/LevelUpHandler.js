const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const CanvasGenerator = require('../utils/CanvasGenerator');
const BountyCalculator = require('../utils/BountyCalculator');
const DatabaseManager = require('./DatabaseManager');

/**
 * LevelUpHandler - Handles level up events and notifications using guild settings
 */
class LevelUpHandler {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.dbManager = new DatabaseManager(db);
        this.canvasGenerator = new CanvasGenerator();
        this.bountyCalculator = new BountyCalculator();
    }

    /**
     * Handle level up event with guild settings
     */
    async handleLevelUp(userId, guildId, oldLevel, newLevel, totalXP, user, member, source) {
        try {
            console.log(`[LEVEL UP] ${user.username}: ${oldLevel} → ${newLevel}`);

            // Get guild settings from database
            const guildSettings = await this.dbManager.getGuildSettings(guildId);

            // Award level roles
            const roleReward = await this.awardLevelRoles(member, newLevel);

            // Send level up notification if enabled
            if (guildSettings?.levelup_enabled) {
                await this.sendLevelUpNotification(userId, guildId, oldLevel, newLevel, totalXP, user, member, roleReward, source, guildSettings);
            } else {
                console.log('[LEVEL UP] Level up announcements disabled for this guild');
            }

            // Log level up if enabled
            if (guildSettings?.xp_log_enabled && guildSettings?.xp_log_channel) {
                await this.logLevelUp(user, guildId, oldLevel, newLevel, totalXP, roleReward, source, guildSettings);
            }

        } catch (error) {
            console.error('Error handling level up:', error);
        }
    }

    /**
     * Award level roles based on new level
     */
    async awardLevelRoles(member, newLevel) {
        try {
            const levelRoles = [
                { level: 0, roleId: process.env.LEVEL_0_ROLE },
                { level: 5, roleId: process.env.LEVEL_5_ROLE },
                { level: 10, roleId: process.env.LEVEL_10_ROLE },
                { level: 15, roleId: process.env.LEVEL_15_ROLE },
                { level: 20, roleId: process.env.LEVEL_20_ROLE },
                { level: 25, roleId: process.env.LEVEL_25_ROLE },
                { level: 30, roleId: process.env.LEVEL_30_ROLE },
                { level: 35, roleId: process.env.LEVEL_35_ROLE },
                { level: 40, roleId: process.env.LEVEL_40_ROLE },
                { level: 45, roleId: process.env.LEVEL_45_ROLE },
                { level: 50, roleId: process.env.LEVEL_50_ROLE }
            ];

            let roleReward = null;

            // Find the highest level role that user qualifies for
            let targetRole = null;
            for (const { level, roleId } of levelRoles.reverse()) {
                if (newLevel >= level && roleId && roleId !== '') {
                    const role = member.guild.roles.cache.get(roleId);
                    if (role) {
                        targetRole = { role, level };
                        break;
                    }
                }
            }

            if (targetRole && !member.roles.cache.has(targetRole.role.id)) {
                // Remove lower level roles first
                for (const { roleId } of levelRoles) {
                    if (roleId && roleId !== '' && roleId !== targetRole.role.id && member.roles.cache.has(roleId)) {
                        const oldRole = member.guild.roles.cache.get(roleId);
                        if (oldRole) {
                            try {
                                await member.roles.remove(oldRole);
                                console.log(`[LEVEL UP] Removed old level role: ${oldRole.name} from ${member.displayName}`);
                            } catch (error) {
                                console.error(`[LEVEL UP] Failed to remove old role ${oldRole.name}:`, error);
                            }
                        }
                    }
                }

                // Add new level role
                try {
                    await member.roles.add(targetRole.role);
                    roleReward = targetRole.role.name;
                    console.log(`[LEVEL UP] Awarded level role: ${targetRole.role.name} to ${member.displayName}`);
                } catch (error) {
                    console.error(`[LEVEL UP] Failed to add role ${targetRole.role.name}:`, error);
                }
            }

            return roleReward;

        } catch (error) {
            console.error('Error awarding level roles:', error);
            return null;
        }
    }

    /**
     * Send level up notification with wanted poster
     */
    async sendLevelUpNotification(userId, guildId, oldLevel, newLevel, totalXP, user, member, roleReward, source, guildSettings) {
        try {
            const channelId = guildSettings?.levelup_channel;
            if (!channelId) {
                console.log('[LEVEL UP] No level up channel configured');
                return;
            }

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                console.log('[LEVEL UP] Level up channel not found or not a text channel');
                return;
            }

            // Check bot permissions in the channel
            const permissions = channel.permissionsFor(this.client.user);
            if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks', 'AttachFiles'])) {
                console.log('[LEVEL UP] Missing permissions in level up channel');
                return;
            }

            // Calculate bounty information
            const oldBounty = this.bountyCalculator.getBountyForLevel(oldLevel);
            const newBounty = this.bountyCalculator.getBountyForLevel(newLevel);
            const bountyIncrease = newBounty - oldBounty;
            const threatLevel = this.bountyCalculator.getThreatLevelName(newLevel);
            
            // Create user data for poster
            const userData = {
                userId: userId,
                level: newLevel,
                total_xp: totalXP,
                messages: 0,
                reactions: 0,
                voice_time: 0,
                member: member,
                isPirateKing: false,
                bounty: newBounty
            };

            // Generate wanted poster
            const canvas = await this.canvasGenerator.createWantedPoster(userData, member.guild);
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `bounty_increase_${userId}.png` });

            // Create level up embed
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: '⚠️ MARINE INTELLIGENCE BUREAU - THREAT LEVEL UPDATE'
                })
                .setColor(0xFF0000)
                .setTitle('🚨 BOUNTY INCREASE CONFIRMED 🚨')
                .setDescription(`\`\`\`diff\n- URGENT: BOUNTY UPDATE REQUIRED\n- Subject: ${member.displayName}\n- Previous Level: ${oldLevel}\n- NEW THREAT LEVEL: ${newLevel}\n- Classification: ${threatLevel}\n- XP Source: ${source.toUpperCase()}\n${roleReward ? `- Marine Rank Assigned: ${roleReward}\n` : ''}\`\`\``)
                .addFields(
                    {
                        name: '💰 BOUNTY ADJUSTMENT',
                        value: `**Previous Bounty:** ฿${oldBounty.toLocaleString()}\n**NEW BOUNTY:** ฿${newBounty.toLocaleString()}\n**Increase:** +฿${bountyIncrease.toLocaleString()}`,
                        inline: true
                    },
                    {
                        name: '📊 THREAT ANALYSIS',
                        value: `**Total XP:** ${totalXP.toLocaleString()}\n**Current Level:** ${newLevel}\n**Threat Class:** ${threatLevel}`,
                        inline: true
                    }
                );

            // Add special message for milestone levels
            const threatMessage = this.bountyCalculator.getThreatLevelMessage(newLevel);
            if (threatMessage !== "Bounty increased. Threat level rising.") {
                embed.addFields({
                    name: '⚠️ MARINE INTELLIGENCE ASSESSMENT',
                    value: `\`\`\`diff\n- ${threatMessage}\n\`\`\``,
                    inline: false
                });
            }

            embed.setImage(`attachment://bounty_increase_${userId}.png`)
                .setFooter({ 
                    text: `⚓ Marine Intelligence Division • Bounty System • Classification: ${threatLevel}`
                })
                .setTimestamp();

            // Send the level up notification
            const pingUser = process.env.LEVELUP_PING_USER === 'true';
            const messageContent = pingUser ? `<@${userId}>` : '';

            await channel.send({ 
                content: messageContent,
                embeds: [embed], 
                files: [attachment] 
            });

            console.log(`[LEVEL UP] ✅ Sent level up notification for ${member.displayName} (${oldLevel} → ${newLevel})`);

        } catch (error) {
            console.error('[LEVEL UP] Error sending level up notification:', error);
        }
    }

    /**
     * Log level up to XP log channel
     */
    async logLevelUp(user, guildId, oldLevel, newLevel, totalXP, roleReward, source, guildSettings) {
        try {
            const logChannelId = guildSettings?.xp_log_channel;
            if (!logChannelId) return;

            const logChannel = await this.client.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel || !logChannel.isTextBased()) return;

            const guild = this.client.guilds.cache.get(guildId);
            const oldBounty = this.bountyCalculator.getBountyForLevel(oldLevel);
            const newBounty = this.bountyCalculator.getBountyForLevel(newLevel);
            const bountyIncrease = newBounty - oldBounty;

            const logEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setAuthor({ 
                    name: '🔴 MARINE INTELLIGENCE BUREAU',
                    iconURL: user.displayAvatarURL({ size: 32 })
                })
                .setTitle('⚠️ THREAT LEVEL INCREASED ⚠️')
                .setDescription(`\`\`\`diff\n- BOUNTY UPDATE CONFIRMED\n- SUBJECT: ${user.username} (${user.id})\n- GUILD: ${guild?.name || 'Unknown'}\n- LEVEL PROGRESSION: ${oldLevel} → ${newLevel}\n- TOTAL XP: ${totalXP.toLocaleString()}\n- OLD BOUNTY: ฿${oldBounty.toLocaleString()}\n- NEW BOUNTY: ฿${newBounty.toLocaleString()}\n- BOUNTY INCREASE: +฿${bountyIncrease.toLocaleString()}\n- XP SOURCE: ${source.toUpperCase()}\n${roleReward ? `- ROLE AWARDED: ${roleReward}\n` : ''}\`\`\``)
                .setTimestamp()
                .setFooter({ text: '⚓ Marine Intelligence Division • Level Up System' });

            await logChannel.send({ embeds: [logEmbed] });

        } catch (error) {
            console.error('[LEVEL UP] Error logging level up:', error);
        }
    }

    /**
     * Handle bulk level role updates (for maintenance)
     */
    async updateAllLevelRoles(guildId) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return { success: false, error: 'Guild not found' };

            const users = await this.dbManager.getLeaderboard(guildId, 1000);
            let updated = 0;
            let errors = 0;

            for (const user of users) {
                try {
                    const member = await guild.members.fetch(user.user_id).catch(() => null);
                    if (member) {
                        await this.awardLevelRoles(member, user.level);
                        updated++;
                    }
                } catch (error) {
                    console.error(`[LEVEL UP] Error updating roles for ${user.user_id}:`, error);
                    errors++;
                }
            }

            return { success: true, updated, errors, total: users.length };

        } catch (error) {
            console.error('[LEVEL UP] Error in bulk role update:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get level role configuration
     */
    getLevelRoleConfig() {
        const roles = [];
        
        for (let level of [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
            const roleId = process.env[`LEVEL_${level}_ROLE`];
            if (roleId && roleId !== '') {
                roles.push({ level, roleId, configured: true });
            } else {
                roles.push({ level, roleId: null, configured: false });
            }
        }
        
        return roles;
    }

    /**
     * Validate level role setup
     */
    async validateLevelRoles(guildId) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return { valid: false, error: 'Guild not found' };

            const issues = [];
            const roleConfig = this.getLevelRoleConfig();
            let validRoles = 0;

            for (const config of roleConfig) {
                if (config.configured) {
                    const role = guild.roles.cache.get(config.roleId);
                    if (!role) {
                        issues.push(`Level ${config.level} role ID ${config.roleId} not found in guild`);
                    } else if (role.position >= guild.members.me.roles.highest.position) {
                        issues.push(`Level ${config.level} role "${role.name}" is higher than bot's highest role`);
                    } else {
                        validRoles++;
                    }
                }
            }

            return {
                valid: issues.length === 0,
                issues,
                configuredRoles: roleConfig.filter(r => r.configured).length,
                validRoles,
                roleConfig
            };

        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    /**
     * Cleanup - prepare for shutdown
     */
    async cleanup() {
        try {
            console.log('🧹 LevelUpHandler cleanup complete');
        } catch (error) {
            console.error('Error during LevelUpHandler cleanup:', error);
        }
    }
}

module.exports = LevelUpHandler;
