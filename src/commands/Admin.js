const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

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
                    await this.handleUserStats(interaction, targetUser, xpManager, databaseManager);
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
     * Handle viewing user stats - ENHANCED WITH DAILY CAP AND TIER INFO
     */
    async handleUserStats(interaction, targetUser, xpManager, databaseManager) {
        try {
            await interaction.deferReply();

            // Get user stats (now includes daily stats)
            const userStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            if (!userStats) {
                return await interaction.editReply({
                    content: '❌ **No Data Found**\n\nThis user has no XP data in this server.'
                });
            }

            // Get member for tier information
            let member = null;
            try {
                member = await interaction.guild.members.fetch(targetUser.id);
            } catch (error) {
                console.log('Could not fetch member for stats');
            }

            // Get bounty information
            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalc = new BountyCalculator();
            const bounty = bountyCalc.getBountyForLevel(userStats.level);
            const threatLevel = bountyCalc.getThreatLevelName(userStats.level);

            // Determine tier information
            let tierInfo = 'No Tier';
            let tierLevel = 0;
            if (member) {
                for (let tier = 10; tier >= 1; tier--) {
                    const roleId = process.env[`TIER_${tier}_ROLE`];
                    if (roleId && member.roles.cache.has(roleId)) {
                        tierInfo = `Tier ${tier}`;
                        tierLevel = tier;
                        break;
                    }
                }
            }

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
                );

            // Add daily stats information
            if (userStats.dailyStats) {
                const daily = userStats.dailyStats;
                const voiceXP = daily.voiceXP || 0;
                const messageXP = daily.messageXP || 0;
                const reactionXP = daily.reactionXP || 0;

                embed.addFields({
                    name: '📅 Daily Progress',
                    value: `**Daily Cap:** ${daily.dailyCap.toLocaleString()} XP\n**Used Today:** ${daily.totalXP.toLocaleString()} XP (${daily.percentage}%)\n**Remaining:** ${daily.remaining.toLocaleString()} XP\n**Tier:** ${tierInfo}`,
                    inline: false
                });

                embed.addFields({
                    name: '🎯 Today\'s XP Sources',
                    value: `**Voice Chat:** ${voiceXP.toLocaleString()} XP\n**Messages:** ${messageXP.toLocaleString()} XP\n**Reactions:** ${reactionXP.toLocaleString()} XP\n**Total:** ${daily.totalXP.toLocaleString()} XP`,
                    inline: false
                });

                // Add tier bonus information if applicable
                if (tierLevel > 0) {
                    const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
                    const bonus = daily.dailyCap - baseCap;
                    embed.addFields({
                        name: '⭐ Tier Benefits',
                        value: `**Tier Level:** ${tierLevel}\n**Base Cap:** ${baseCap.toLocaleString()} XP\n**Tier Bonus:** +${bonus.toLocaleString()} XP\n**Total Cap:** ${daily.dailyCap.toLocaleString()} XP`,
                        inline: false
                    });
                }

                // Add cap status
                if (daily.isAtCap) {
                    embed.addFields({
                        name: '🚫 Daily Cap Status',
                        value: '```diff\n- DAILY CAP REACHED\n- No more XP can be gained today\n- Cap resets at 7:35 PM EDT\n```',
                        inline: false
                    });
                } else {
                    const nextReset = new Date();
                    nextReset.setHours(19, 35, 0, 0); // 7:35 PM EDT
                    if (nextReset.getTime() <= Date.now()) {
                        nextReset.setDate(nextReset.getDate() + 1);
                    }
                    
                    embed.addFields({
                        name: '✅ Daily Cap Status',
                        value: `\`\`\`diff\n+ CAN STILL GAIN XP\n+ Remaining: ${daily.remaining.toLocaleString()} XP\n+ Next Reset: <t:${Math.floor(nextReset.getTime() / 1000)}:R>\n\`\`\``,
                        inline: false
                    });
                }
            }

            embed.setFooter({ text: `⚓ Marine Intelligence • Dossier compiled by ${interaction.user.username}` })
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
