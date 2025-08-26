const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const CanvasGenerator = require('../utils/CanvasGenerator');
const BountyCalculator = require('../utils/BountyCalculator');

/**
 * LevelUpHandler - Handles level up events and notifications
 */
class LevelUpHandler {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.canvasGenerator = new CanvasGenerator();
        this.bountyCalculator = new BountyCalculator();
    }

    /**
     * Handle level up event
     */
    async handleLevelUp(userId, guildId, oldLevel, newLevel, totalXP, user, member, source) {
        try {
            console.log(`[LEVEL UP] ${user.username}: ${oldLevel} → ${newLevel}`);

            // Award level roles
            const roleReward = await this.awardLevelRoles(member, newLevel);

            // Send level up notification
            await this.sendLevelUpNotification(userId, guildId, oldLevel, newLevel, totalXP, user, member, roleReward, source);

            // Log level up if enabled
            await this.logLevelUp(user, guildId, oldLevel, newLevel, totalXP, roleReward, source);

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
                if (newLevel >= level && roleId) {
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
                    if (roleId && roleId !== targetRole.role.id && member.roles.cache.has(roleId)) {
                        const oldRole = member.guild.roles.cache.get(roleId);
                        if (oldRole) {
                            await member.roles.remove(oldRole);
                            console.log(`[LEVEL UP] Removed ${oldRole.name} from ${member.user.username}`);
                        }
                    }
                }

                // Add new role
                await member.roles.add(targetRole.role);
                roleReward = targetRole.role.name;
                console.log(`[LEVEL UP] Added ${targetRole.role.name} to ${member.user.username}`);
            }

            return roleReward;

        } catch (error) {
            console.error('Error awarding level roles:', error);
            return null;
        }
    }

    /**
     * Send level up notification with canvas
     */
    async sendLevelUpNotification(userId, guildId, oldLevel, newLevel, totalXP, user, member, roleReward, source) {
        try {
            if (process.env.LEVELUP_ENABLED !== 'true') {
                console.log('[LEVEL UP] Level up announcements disabled');
                return;
            }

            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            // Find appropriate channel
            let channelId = null;
            
            // Look for level up channel, general channel, or any text channel
            const channels = guild.channels.cache.filter(ch => ch.isTextBased());
            
            // Priority: channels with 'level', 'bounty', 'general', 'chat' in name
            const priorityNames = ['level', 'bounty', 'general', 'chat'];
            for (const name of priorityNames) {
                const channel = channels.find(ch => ch.name.toLowerCase().includes(name));
                if (channel) {
                    channelId = channel.id;
                    break;
                }
            }
            
            // Fallback to first available text channel
            if (!channelId) {
                const firstChannel = channels.first();
                if (firstChannel) {
                    channelId = firstChannel.id;
                }
            }

            if (!channelId) {
                console.log('[LEVEL UP] No suitable channel found for announcements');
                return;
            }

            const channel = guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased()) {
                console.log(`[LEVEL UP] Channel ${channelId} not found or not text-based`);
                return;
            }

            // Create wanted poster canvas
            const userData = {
                userId: user.id,
                level: newLevel,
                total_xp: totalXP,
                messages: 0,
                reactions: 0,
                voice_time: 0,
                member: member,
                isPirateKing: this.isPirateKing(member)
            };

            const canvas = await this.canvasGenerator.createWantedPoster(userData, guild);
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `levelup_wanted_${user.id}.png` });

            // Create level up embed
            const embed = this.createLevelUpEmbed(user, oldLevel, newLevel, totalXP, roleReward, source);

            const messageOptions = { 
                embeds: [embed], 
                files: [attachment] 
            };
            
            // Ping user if enabled
            if (process.env.LEVELUP_PING_USER === 'true') {
                messageOptions.content = `<@${userId}>`;
            }
            
            await channel.send(messageOptions);
            console.log(`[LEVEL UP] ✅ Level up notification sent for ${user.username} in #${channel.name}`);

        } catch (error) {
            console.error('❌ Error sending level up notification:', error);
        }
    }

    /**
     * Create level up embed
     */
    createLevelUpEmbed(user, oldLevel, newLevel, totalXP, roleReward, source) {
        try {
            const oldBounty = this.bountyCalculator.getBountyForLevel(oldLevel);
            const newBounty = this.bountyCalculator.getBountyForLevel(newLevel);

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(0xFF0000)
                .setTitle('🚨 WORLD GOVERNMENT BOUNTY UPDATE 🚨')
                .setDescription(`**${user.username}** has reached a new level of infamy!`)
                .addFields({
                    name: '📊 INTELLIGENCE SUMMARY',
                    value: `\`\`\`diff\n- Subject: ${user.username}\n- Previous Bounty: ฿${oldBounty.toLocaleString()}\n- New Bounty: ฿${newBounty.toLocaleString()}\n- Level: ${oldLevel} → ${newLevel}\n- Total XP: ${totalXP.toLocaleString()}\n- XP Source: ${source.toUpperCase()}\n${roleReward ? `- Role Awarded: ${roleReward}\n` : ''}\`\`\``,
                    inline: false
                })
                .setImage(`attachment://levelup_wanted_${user.id}.png`)
                .setFooter({ text: '⚓ Marine Intelligence Division • Bounty System' })
                .setTimestamp();

            return embed;
        } catch (error) {
            console.error('Error creating level up embed:', error);
            
            return new EmbedBuilder()
                .setColor('#DC143C')
                .setTitle('🚨 LEVEL UP! 🚨')
                .setDescription(`**${user.username}** leveled up from ${oldLevel} to ${newLevel}!`)
                .setThumbnail(user.displayAvatarURL({ size: 128 }))
                .setTimestamp();
        }
    }

    /**
     * Log level up event
     */
    async logLevelUp(user, guildId, oldLevel, newLevel, totalXP, roleReward, source) {
        try {
            if (process.env.XP_LOG_ENABLED !== 'true' || process.env.XP_LOG_LEVELUP !== 'true') {
                return;
            }

            const channelId = process.env.XP_LOG_CHANNEL;
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const oldBounty = this.bountyCalculator.getBountyForLevel(oldLevel);
            const newBounty = this.bountyCalculator.getBountyForLevel(newLevel);
            const bountyIncrease = newBounty - oldBounty;

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setAuthor({ 
                    name: '🔴 MARINE INTELLIGENCE BUREAU',
                    iconURL: user.displayAvatarURL({ size: 32 })
                })
                .setTitle('🔴 ⚠️ THREAT LEVEL INCREASED ⚠️')
                .setDescription(`\`\`\`diff\n- BOUNTY UPDATE CONFIRMED\n- SUBJECT: ${user.username} (${user.id})\n- LEVEL PROGRESSION: ${oldLevel} → ${newLevel}\n- TOTAL XP: ${totalXP.toLocaleString()}\n- OLD BOUNTY: ฿${oldBounty.toLocaleString()}\n- NEW BOUNTY: ฿${newBounty.toLocaleString()}\n- BOUNTY INCREASE: +฿${bountyIncrease.toLocaleString()}\n- XP SOURCE: ${source.toUpperCase()}\n${roleReward ? `- ROLE AWARDED: ${roleReward}\n` : ''}\`\`\``)
                .setTimestamp()
                .setFooter({ text: '⚓ Marine Intelligence Division' });

            await channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('[XP LOG] Failed to send level up log:', error);
        }
    }

    /**
     * Check if member is Pirate King
     */
    isPirateKing(member) {
        try {
            const excludedRoleId = process.env.LEADERBOARD_EXCLUDE_ROLE;
            return excludedRoleId && member.roles.cache.has(excludedRoleId);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get threat level name for level
     */
    getThreatLevelName(level, isPirateKing = false) {
        if (isPirateKing) return "PIRATE KING";
        if (level >= 50) return "EMPEROR CLASS";
        if (level >= 45) return "EXTRAORDINARY";
        if (level >= 40) return "ELITE LEVEL";
        if (level >= 35) return "TERRITORIAL";
        if (level >= 30) return "ADVANCED COMBATANT";
        if (level >= 25) return "HIGH PRIORITY";
        if (level >= 20) return "DANGEROUS";
        if (level >= 15) return "GRAND LINE";
        if (level >= 10) return "ELEVATED";
        if (level >= 5) return "CONFIRMED CRIMINAL";
        return "MONITORING";
    }
}

module.exports = LevelUpHandler;
