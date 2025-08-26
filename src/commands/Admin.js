const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Admin user ID from environment
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '1095470472390508658';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('⚓ Marine Command Center - Complete Administration Suite')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Select administrative action to perform')
                .setRequired(true)
                .addChoices(
                    { name: '📈 Add XP to User', value: 'add-xp' },
                    { name: '📉 Remove XP from User', value: 'remove-xp' },
                    { name: '🔄 Set User XP Total', value: 'set-xp' },
                    { name: '🗑️ Reset User Completely', value: 'reset-user' },
                    { name: '📊 View User Stats', value: 'user-stats' },
                    { name: '📋 Bot Statistics', value: 'bot-stats' },
                    { name: '🔧 Database Maintenance', value: 'maintenance' },
                    { name: '🔄 Force Daily Reset', value: 'daily-reset' }
                )
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Target user (required for XP operations)')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('XP amount (for add/remove/set actions)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100000)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for this action')
                .setRequired(false)
        ),

    async execute(interaction, { xpManager, databaseManager }) {
        try {
            // Check if user is authorized admin
            if (interaction.user.id !== ADMIN_USER_ID) {
                return await interaction.reply({
                    content: '❌ **Access Denied**\n\n⚓ **Marine Command Center** requires special authorization.\n\nOnly authorized Marine officers may access these commands.',
                    ephemeral: true
                });
            }

            const action = interaction.options.getString('action');
            const targetUser = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const reason = interaction.options.getString('reason') || 'No reason specified';

            // Handle XP operations that require a target user
            if (['add-xp', 'remove-xp', 'set-xp', 'reset-user', 'user-stats'].includes(action)) {
                if (!targetUser) {
                    return await interaction.reply({
                        content: '❌ **Missing Target User**\n\nPlease specify a user for this operation.',
                        ephemeral: true
                    });
                }

                // Prevent targeting bots
                if (targetUser.bot) {
                    return await interaction.reply({
                        content: '❌ **Invalid Target**\n\nCannot modify XP for bot accounts.',
                        ephemeral: true
                    });
                }
            }

            switch (action) {
                case 'add-xp':
                    if (!amount || amount < 1 || amount > 10000) {
                        return await interaction.reply({
                            content: '❌ **Invalid Amount**\n\nPlease specify an amount between 1 and 10,000 XP.',
                            ephemeral: true
                        });
                    }
                    await this.handleAddXP(interaction, targetUser, amount, reason, xpManager, databaseManager);
                    break;

                case 'remove-xp':
                    if (!amount || amount < 1 || amount > 10000) {
                        return await interaction.reply({
                            content: '❌ **Invalid Amount**\n\nPlease specify an amount between 1 and 10,000 XP.',
                            ephemeral: true
                        });
                    }
                    await this.handleRemoveXP(interaction, targetUser, amount, reason, xpManager, databaseManager);
                    break;

                case 'set-xp':
                    if (amount === null || amount < 0 || amount > 100000) {
                        return await interaction.reply({
                            content: '❌ **Invalid Amount**\n\nPlease specify an amount between 0 and 100,000 XP.',
                            ephemeral: true
                        });
                    }
                    await this.handleSetXP(interaction, targetUser, amount, reason, xpManager, databaseManager);
                    break;

                case 'reset-user':
                    await this.handleResetUser(interaction, targetUser, reason, xpManager, databaseManager);
                    break;

                case 'user-stats':
                    await this.handleUserStats(interaction, targetUser, xpManager);
                    break;

                case 'bot-stats':
                    await this.handleBotStats(interaction, xpManager, databaseManager);
                    break;

                case 'maintenance':
                    await this.handleMaintenance(interaction, databaseManager);
                    break;

                case 'daily-reset':
                    await this.handleDailyReset(interaction, xpManager);
                    break;

                default:
                    return await interaction.reply({
                        content: '❌ **Unknown Action**\n\nPlease use a valid action from the dropdown.',
                        ephemeral: true
                    });
            }

        } catch (error) {
            console.error('[ADMIN ERROR]', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🚨 MARINE INTELLIGENCE - SYSTEM ERROR')
                .setDescription('```diff\n- CRITICAL SYSTEM FAILURE DETECTED\n- OPERATION TERMINATED```')
                .addFields({
                    name: '📋 Error Details',
                    value: `\`\`\`${error.message}\`\`\``
                })
                .setTimestamp()
                .setFooter({ text: 'Marine Intelligence Network' });

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },

    /**
     * Handle adding XP to user
     */
    async handleAddXP(interaction, targetUser, amount, reason, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get current user stats
            const currentStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            const oldLevel = currentStats?.level || 0;
            const oldTotalXP = currentStats?.total_xp || 0;

            // Get member for XP award
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return await interaction.editReply({
                    content: '❌ **User Not Found**\n\nCould not find this user in the server.'
                });
            }

            // Award XP using the XP manager
            await xpManager.awardXP(targetUser.id, interaction.guild.id, amount, 'admin', targetUser, member);

            // Get updated stats
            const updatedStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            const newLevel = updatedStats?.level || 0;
            const newTotalXP = updatedStats?.total_xp || 0;

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('⚓ MARINE COMMAND CENTER')
                .setDescription('**XP AWARDED SUCCESSFULLY**')
                .addFields(
                    {
                        name: '🎯 Target',
                        value: `${targetUser.username} (${targetUser.id})`,
                        inline: true
                    },
                    {
                        name: '📈 XP Change',
                        value: `+${amount.toLocaleString()} XP`,
                        inline: true
                    },
                    {
                        name: '📊 Results',
                        value: `**Before:** ${oldTotalXP.toLocaleString()} XP (Level ${oldLevel})\n**After:** ${newTotalXP.toLocaleString()} XP (Level ${newLevel})`,
                        inline: false
                    },
                    {
                        name: '📝 Reason',
                        value: reason,
                        inline: false
                    }
                )
                .setFooter({ text: `⚓ Authorized by ${interaction.user.username} • Marine Intelligence` })
                .setTimestamp();

            // Add level up notification if level changed
            if (newLevel > oldLevel) {
                embed.addFields({
                    name: '🚨 Level Up Detected',
                    value: `${targetUser.username} gained ${newLevel - oldLevel} level(s)! Check announcements for bounty updates.`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Add XP error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to award XP. Please try again.'
            });
        }
    },

    /**
     * Handle removing XP from user
     */
    async handleRemoveXP(interaction, targetUser, amount, reason, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get current user stats
            const currentStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            if (!currentStats) {
                return await interaction.editReply({
                    content: '❌ **User Not Found**\n\nThis user has no XP data in this server.'
                });
            }

            const oldLevel = currentStats.level;
            const oldTotalXP = currentStats.total_xp;

            // Calculate new XP (ensure it doesn't go below 0)
            const newTotalXP = Math.max(0, oldTotalXP - amount);
            
            // Use database manager to directly set the XP
            await databaseManager.updateUserXP(targetUser.id, interaction.guild.id, -(oldTotalXP - newTotalXP), 'admin');
            
            // Calculate and update new level
            const LevelCalculator = require('../utils/LevelCalculator');
            const levelCalc = new LevelCalculator();
            const newLevel = levelCalc.calculateLevel(newTotalXP);
            await databaseManager.updateUserLevel(targetUser.id, interaction.guild.id, newLevel);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('⚓ MARINE COMMAND CENTER')
                .setDescription('**XP REMOVED SUCCESSFULLY**')
                .addFields(
                    {
                        name: '🎯 Target',
                        value: `${targetUser.username} (${targetUser.id})`,
                        inline: true
                    },
                    {
                        name: '📉 XP Change',
                        value: `-${amount.toLocaleString()} XP`,
                        inline: true
                    },
                    {
                        name: '📊 Results',
                        value: `**Before:** ${oldTotalXP.toLocaleString()} XP (Level ${oldLevel})\n**After:** ${newTotalXP.toLocaleString()} XP (Level ${newLevel})`,
                        inline: false
                    },
                    {
                        name: '📝 Reason',
                        value: reason,
                        inline: false
                    }
                )
                .setFooter({ text: `⚓ Authorized by ${interaction.user.username} • Marine Intelligence` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Remove XP error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to remove XP. Please try again.'
            });
        }
    },

    /**
     * Handle setting user XP total
     */
    async handleSetXP(interaction, targetUser, amount, reason, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get current stats
            const currentStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            const oldLevel = currentStats?.level || 0;
            const oldTotalXP = currentStats?.total_xp || 0;

            // Calculate new level
            const LevelCalculator = require('../utils/LevelCalculator');
            const levelCalc = new LevelCalculator();
            const newLevel = levelCalc.calculateLevel(amount);

            // Set XP directly in database
            await databaseManager.updateUserXP(targetUser.id, interaction.guild.id, amount - oldTotalXP, 'admin');
            await databaseManager.updateUserLevel(targetUser.id, interaction.guild.id, newLevel);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#4A90E2')
                .setTitle('⚓ MARINE COMMAND CENTER')
                .setDescription('**XP SET SUCCESSFULLY**')
                .addFields(
                    {
                        name: '🎯 Target',
                        value: `${targetUser.username} (${targetUser.id})`,
                        inline: true
                    },
                    {
                        name: '🔄 XP Change',
                        value: `Set to ${amount.toLocaleString()} XP`,
                        inline: true
                    },
                    {
                        name: '📊 Results',
                        value: `**Before:** ${oldTotalXP.toLocaleString()} XP (Level ${oldLevel})\n**After:** ${amount.toLocaleString()} XP (Level ${newLevel})`,
                        inline: false
                    },
                    {
                        name: '📝 Reason',
                        value: reason,
                        inline: false
                    }
                )
                .setFooter({ text: `⚓ Authorized by ${interaction.user.username} • Marine Intelligence` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Set XP error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to set XP. Please try again.'
            });
        }
    },

    /**
     * Handle resetting user completely
     */
    async handleResetUser(interaction, targetUser, reason, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get current stats before reset
            const currentStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            const oldLevel = currentStats?.level || 0;
            const oldTotalXP = currentStats?.total_xp || 0;

            // Reset user by setting XP to 0
            await databaseManager.updateUserXP(targetUser.id, interaction.guild.id, -oldTotalXP, 'admin');
            await databaseManager.updateUserLevel(targetUser.id, interaction.guild.id, 0);

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⚓ MARINE COMMAND CENTER')
                .setDescription('**USER RESET SUCCESSFULLY**')
                .addFields(
                    {
                        name: '🎯 Target',
                        value: `${targetUser.username} (${targetUser.id})`,
                        inline: true
                    },
                    {
                        name: '🔄 Action',
                        value: 'Complete Reset',
                        inline: true
                    },
                    {
                        name: '📊 Previous Data',
                        value: `**XP:** ${oldTotalXP.toLocaleString()}\n**Level:** ${oldLevel}`,
                        inline: false
                    },
                    {
                        name: '📝 Reason',
                        value: reason,
                        inline: false
                    }
                )
                .setFooter({ text: `⚓ Authorized by ${interaction.user.username} • Marine Intelligence` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Reset user error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to reset user. Please try again.'
            });
        }
    },

    /**
     * Handle viewing user stats
     */
    async handleUserStats(interaction, targetUser, xpManager) {
        try {
            await interaction.deferReply();

            // Get user stats
            const userStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            if (!userStats) {
                return await interaction.editReply({
                    content: '❌ **No Data Found**\n\nThis user has no XP data in this server.'
                });
            }

            // Get bounty information
            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalc = new BountyCalculator();
            const bounty = bountyCalc.getBountyForLevel(userStats.level);
            const threatLevel = bountyCalc.getThreatLevelName(userStats.level);

            // Create detailed stats embed
            const embed = new EmbedBuilder()
                .setColor('#4A90E2')
                .setTitle('⚓ MARINE INTELLIGENCE DOSSIER')
                .setDescription(`**${targetUser.username}** • Detailed Criminal Profile`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                .addFields(
                    {
                        name: '🎯 Subject Information',
                        value: `**User ID:** ${targetUser.id}\n**Rank:** #${userStats.rank || 'Unknown'}\n**Bounty:** ฿${bounty.toLocaleString()}\n**Threat Level:** ${threatLevel}`,
                        inline: false
                    },
                    {
                        name: '📊 Criminal Activity',
                        value: `**Total XP:** ${userStats.total_xp.toLocaleString()}\n**Current Level:** ${userStats.level}`,
                        inline: true
                    },
                    {
                        name: '📈 Activity Breakdown',
                        value: `**Messages:** ${userStats.messages.toLocaleString()}\n**Reactions:** ${userStats.reactions.toLocaleString()}\n**Voice Time:** ${userStats.voice_time.toLocaleString()} minutes`,
                        inline: true
                    }
                )
                .setFooter({ text: `⚓ Marine Intelligence • Dossier compiled by ${interaction.user.username}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Stats error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to retrieve user stats. Please try again.'
            });
        }
    },

    /**
     * Handle bot statistics
     */
    async handleBotStats(interaction, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get guild count
            const guildCount = interaction.client.guilds.cache.size;
            
            // Get user count from database
            const userResult = await databaseManager.db.query('SELECT COUNT(DISTINCT user_id) as user_count FROM user_levels');
            const userCount = userResult.rows[0]?.user_count || 0;

            // Get total XP
            const xpResult = await databaseManager.db.query('SELECT SUM(total_xp) as total_xp, AVG(total_xp) as avg_xp FROM user_levels WHERE total_xp > 0');
            const totalXP = xpResult.rows[0]?.total_xp || 0;
            const avgXP = Math.round(xpResult.rows[0]?.avg_xp || 0);

            // Get level distribution
            const levelResult = await databaseManager.db.query('SELECT level, COUNT(*) as count FROM user_levels WHERE level > 0 GROUP BY level ORDER BY level DESC LIMIT 5');
            const topLevels = levelResult.rows;

            const statsEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🏛️ MARINE INTELLIGENCE - OPERATIONAL STATISTICS')
                .setDescription('```diff\n+ MARINE DATABASE METRICS\n+ SECURITY CLEARANCE: ADMIRAL LEVEL```')
                .addFields(
                    {
                        name: '📊 Network Statistics',
                        value: `\`\`\`yaml\nActive Guilds: ${guildCount}\nTracked Users: ${userCount}\nTotal XP Issued: ${totalXP.toLocaleString()}\nAverage XP: ${avgXP.toLocaleString()}\`\`\``,
                        inline: false
                    },
                    {
                        name: '🏆 Top Level Distribution',
                        value: topLevels.length > 0 
                            ? `\`\`\`yaml\n${topLevels.map(l => `Level ${l.level}: ${l.count} Marines`).join('\n')}\`\`\``
                            : '```yaml\nNo level data available```',
                        inline: false
                    },
                    {
                        name: '⚙️ System Status',
                        value: '```diff\n+ Database: OPERATIONAL\n+ XP Tracking: ACTIVE\n+ Voice Monitoring: ACTIVE\n+ Wanted Posters: OPERATIONAL```',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Marine Intelligence Network' });

            await interaction.editReply({ embeds: [statsEmbed] });

        } catch (error) {
            console.error('Bot stats error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to retrieve bot statistics. Please try again.'
            });
        }
    },

    /**
     * Handle database maintenance
     */
    async handleMaintenance(interaction, databaseManager) {
        try {
            const maintenanceButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('cleanup_inactive')
                        .setLabel('🧹 Clean Inactive Users')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('optimize_db')
                        .setLabel('⚡ Optimize Database')
                        .setStyle(ButtonStyle.Success)
                );

            const maintenanceEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🔧 MARINE INTELLIGENCE - MAINTENANCE OPERATIONS')
                .setDescription('```diff\n+ AUTHORIZED MAINTENANCE PROTOCOLS\n+ SELECT OPERATION TO EXECUTE```')
                .addFields({
                    name: '⚠️ Available Operations',
                    value: `\`\`\`yaml\n🧹 Clean Inactive: Remove users with 0 XP and no activity\n⚡ Optimize: Rebuild database indexes and clean logs\`\`\``
                })
                .setTimestamp()
                .setFooter({ text: 'Marine Intelligence - Maintenance Division' });

            await interaction.reply({ 
                embeds: [maintenanceEmbed], 
                components: [maintenanceButtons],
                ephemeral: true
            });

        } catch (error) {
            console.error('Maintenance error:', error);
            await interaction.reply({
                content: '❌ **Maintenance Error**\n\nFailed to initialize maintenance operations.',
                ephemeral: true
            });
        }
    },

    /**
     * Handle daily reset
     */
    async handleDailyReset(interaction, xpManager) {
        try {
            await interaction.deferReply();

            // Trigger daily reset
            if (xpManager.dailyCapManager) {
                await xpManager.dailyCapManager.resetDaily();
                
                const resetEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('🌅 DAILY RESET COMPLETE')
                    .setDescription('```diff\n+ Daily XP caps have been reset\n+ All users can now gain XP again\n+ Reset triggered manually by admin```')
                    .setTimestamp()
                    .setFooter({ text: `⚓ Authorized by ${interaction.user.username} • Marine Intelligence` });

                await interaction.editReply({ embeds: [resetEmbed] });
            } else {
                await interaction.editReply({
                    content: '❌ **Daily Reset Unavailable**\n\nDaily cap manager is not initialized.'
                });
            }

        } catch (error) {
            console.error('Daily reset error:', error);
            await interaction.editReply({
                content: '❌ **Operation Failed**\n\nFailed to perform daily reset. Please try again.'
            });
        }
    }
};
