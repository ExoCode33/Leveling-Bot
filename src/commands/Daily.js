const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('⏰ View daily XP progress and caps')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check daily progress for')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of daily information to show')
                .setRequired(false)
                .addChoices(
                    { name: '👤 My Progress', value: 'progress' },
                    { name: '🏆 Daily Leaderboard', value: 'leaderboard' },
                    { name: '📊 Server Stats', value: 'server' },
                    { name: '🎯 Tier Information', value: 'tiers' }
                )),

    async execute(interaction, { xpManager, databaseManager }) {
        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const type = interaction.options.getString('type') || 'progress';
            
            // Defer reply for processing
            await interaction.deferReply();

            switch (type) {
                case 'progress':
                    await this.handleProgressView(interaction, targetUser, xpManager);
                    break;
                case 'leaderboard':
                    await this.handleLeaderboardView(interaction, xpManager);
                    break;
                case 'server':
                    await this.handleServerStatsView(interaction, xpManager);
                    break;
                case 'tiers':
                    await this.handleTierInfoView(interaction, xpManager);
                    break;
                default:
                    await this.handleProgressView(interaction, targetUser, xpManager);
                    break;
            }

        } catch (error) {
            console.error('[DAILY] Error in daily command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Daily Stats Error')
                .setDescription('Failed to load daily XP information. Please try again.')
                .setTimestamp();

            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },

    /**
     * Handle individual progress view
     */
    async handleProgressView(interaction, targetUser, xpManager) {
        try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return await interaction.editReply({
                    content: '❌ **User Not Found**\n\nCould not find this user in the server.',
                });
            }

            // Get daily stats
            const dailyStats = await xpManager.dailyCapManager.getDailyStats(
                targetUser.id, 
                interaction.guild.id, 
                member
            );

            // Create progress bar
            const progressBar = this.createProgressBar(dailyStats.percentage);
            const timeUntilReset = this.getTimeUntilReset(xpManager.dailyCapManager.getNextResetTimestamp());

            const embed = new EmbedBuilder()
                .setColor(dailyStats.isAtCap ? 0xFF0000 : 0x4A90E2)
                .setAuthor({ 
                    name: '⏰ MARINE INTELLIGENCE - DAILY ACTIVITY REPORT',
                    iconURL: targetUser.displayAvatarURL({ size: 32 })
                })
                .setTitle(`📊 Daily XP Progress - ${member.displayName}`)
                .setDescription(`\`\`\`diff\n${dailyStats.isAtCap ? '- DAILY CAP REACHED' : '+ ACTIVE MONITORING'}\n- Date: ${dailyStats.date}\n- Subject: ${targetUser.username}\n- Daily Cap Tier: ${dailyStats.tierName}\n\`\`\``)
                .addFields(
                    {
                        name: '📈 Daily Progress',
                        value: `\`\`\`yaml\nCurrent XP: ${dailyStats.totalXP.toLocaleString()}\nDaily Cap: ${dailyStats.dailyCap.toLocaleString()}\nRemaining: ${dailyStats.remaining.toLocaleString()}\nProgress: ${dailyStats.percentage}%\n\`\`\``,
                        inline: true
                    },
                    {
                        name: '📊 XP Breakdown',
                        value: `\`\`\`yaml\nMessages: ${dailyStats.messageXP.toLocaleString()}\nVoice: ${dailyStats.voiceXP.toLocaleString()}\nReactions: ${dailyStats.reactionXP.toLocaleString()}\n\`\`\``,
                        inline: true
                    },
                    {
                        name: '⏱️ Progress Bar',
                        value: `${progressBar}\n**${dailyStats.percentage}%** complete`,
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `⚓ Next reset: ${timeUntilReset} • Marine Intelligence Division`
                })
                .setTimestamp();

            // Add tier information if applicable
            if (dailyStats.tierLevel > 0) {
                embed.addFields({
                    name: '🎯 Tier Benefits',
                    value: `\`\`\`diff\n+ Tier Level: ${dailyStats.tierLevel}\n+ Enhanced Daily Cap: ${dailyStats.dailyCap.toLocaleString()} XP\n+ Standard Cap: ${parseInt(process.env.DAILY_XP_CAP || 15000).toLocaleString()} XP\n+ Bonus Cap: +${(dailyStats.dailyCap - parseInt(process.env.DAILY_XP_CAP || 15000)).toLocaleString()} XP\n\`\`\``,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[DAILY] Error in progress view:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nFailed to load daily progress. Please try again.'
            });
        }
    },

    /**
     * Handle daily leaderboard view
     */
    async handleLeaderboardView(interaction, xpManager) {
        try {
            const leaderboard = await xpManager.dailyCapManager.getDailyLeaderboard(interaction.guild.id, 10);
            
            if (leaderboard.length === 0) {
                return await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x4A90E2)
                        .setTitle('🏆 Daily XP Leaderboard')
                        .setDescription('No daily activity recorded yet today.')
                        .setTimestamp()
                    ]
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x4A90E2)
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setTitle('🏆 DAILY ACTIVITY LEADERBOARD')
                .setDescription(`\`\`\`diff\n- TOP 10 MOST ACTIVE PIRATES TODAY\n- Daily Reset: ${this.getTimeUntilReset(xpManager.dailyCapManager.getNextResetTimestamp())}\n\`\`\``);

            let leaderboardText = '';
            for (let i = 0; i < leaderboard.length; i++) {
                const entry = leaderboard[i];
                
                try {
                    const member = await interaction.guild.members.fetch(entry.userId).catch(() => null);
                    const displayName = member ? member.displayName : `Unknown User`;
                    
                    const rank = i + 1;
                    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '📍';
                    const capStatus = entry.isAtCap ? '🔴 CAP' : '🟢 ACT';
                    const tierInfo = entry.tierLevel > 0 ? `T${entry.tierLevel}` : 'STD';
                    
                    leaderboardText += `${rankEmoji} **${rank}.** ${displayName}\n`;
                    leaderboardText += `\`\`\`yaml\nXP: ${entry.totalXP.toLocaleString()}/${entry.dailyCap.toLocaleString()} (${entry.percentage}%)\nTier: ${tierInfo} | Status: ${capStatus}\n\`\`\`\n`;
                } catch (error) {
                    console.error(`[DAILY] Error fetching member ${entry.userId}:`, error);
                }
            }

            embed.addFields({
                name: '📊 DAILY ACTIVITY RANKINGS',
                value: leaderboardText || 'No data available',
                inline: false
            });

            const timeUntilReset = this.getTimeUntilReset(xpManager.dailyCapManager.getNextResetTimestamp());
            embed.setFooter({ 
                text: `⚓ Next reset: ${timeUntilReset} • Marine Intelligence Division`
            })
            .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[DAILY] Error in leaderboard view:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nFailed to load daily leaderboard. Please try again.'
            });
        }
    },

    /**
     * Handle server stats view
     */
    async handleServerStatsView(interaction, xpManager) {
        try {
            const guildStats = await xpManager.dailyCapManager.getGuildDailyStats(interaction.guild.id);
            const timeUntilReset = this.getTimeUntilReset(guildStats.nextReset);

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setTitle('📊 SERVER DAILY ACTIVITY REPORT')
                .setDescription(`\`\`\`diff\n+ COMPREHENSIVE DAILY ANALYSIS\n+ Server: ${interaction.guild.name}\n+ Date: ${guildStats.date}\n+ Reset: ${timeUntilReset}\n\`\`\``)
                .addFields(
                    {
                        name: '👥 Activity Overview',
                        value: `\`\`\`yaml\nActive Users: ${guildStats.activeUsers.toLocaleString()}\nUsers at Cap: ${guildStats.usersAtCap.toLocaleString()}\nTotal Guild XP: ${guildStats.totalGuildXP.toLocaleString()}\nAverage per User: ${guildStats.averageUserXP.toLocaleString()}\nHighest User XP: ${guildStats.highestUserXP.toLocaleString()}\n\`\`\``,
                        inline: false
                    },
                    {
                        name: '📈 XP Source Breakdown',
                        value: `\`\`\`yaml\nMessage XP: ${guildStats.totalMessageXP.toLocaleString()}\nVoice XP: ${guildStats.totalVoiceXP.toLocaleString()}\nReaction XP: ${guildStats.totalReactionXP.toLocaleString()}\n\`\`\``,
                        inline: true
                    },
                    {
                        name: '🎯 Cap Information',
                        value: `\`\`\`yaml\nAverage Daily Cap: ${guildStats.averageDailyCap.toLocaleString()}\nBase Daily Cap: ${parseInt(process.env.DAILY_XP_CAP || 15000).toLocaleString()}\nTier Users: ${guildStats.tierUsers.length}\n\`\`\``,
                        inline: true
                    }
                );

            // Add users at cap if any
            if (guildStats.usersAtCapList.length > 0) {
                let atCapText = '';
                for (let i = 0; i < Math.min(5, guildStats.usersAtCapList.length); i++) {
                    const capUser = guildStats.usersAtCapList[i];
                    try {
                        const member = await interaction.guild.members.fetch(capUser.user_id).catch(() => null);
                        const displayName = member ? member.displayName : 'Unknown User';
                        const tierText = capUser.tier_level > 0 ? ` (T${capUser.tier_level})` : '';
                        atCapText += `• ${displayName}${tierText}: ${capUser.total_xp.toLocaleString()}/${capUser.daily_cap.toLocaleString()}\n`;
                    } catch (error) {
                        console.error(`[DAILY] Error fetching capped user ${capUser.user_id}:`, error);
                    }
                }
                
                if (guildStats.usersAtCapList.length > 5) {
                    atCapText += `*...and ${guildStats.usersAtCapList.length - 5} more*`;
                }

                embed.addFields({
                    name: '🔴 Users at Daily Cap',
                    value: atCapText || 'None',
                    inline: false
                });
            }

            embed.setFooter({ 
                text: `⚓ Marine Intelligence Division • Server: ${interaction.guild.name}`
            })
            .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[DAILY] Error in server stats view:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nFailed to load server stats. Please try again.'
            });
        }
    },

    /**
     * Handle tier information view
     */
    async handleTierInfoView(interaction, xpManager) {
        try {
            const validation = xpManager.dailyCapManager.validateTierConfiguration();
            const tierInfo = xpManager.dailyCapManager.getTierRoleInfo();

            const embed = new EmbedBuilder()
                .setColor(validation.valid ? 0x00FF00 : 0xFFA500)
                .setTitle('🎯 Tier System Information')
                .setDescription(`Current tier role configuration and daily cap bonuses`)
                .addFields({
                    name: '📊 Configuration Status',
                    value: `\`\`\`yaml\nBase Daily Cap: ${validation.baseCap.toLocaleString()} XP\nConfigured Tiers: ${validation.configuredTiers}/10\nStatus: ${validation.valid ? 'Valid' : 'Issues Found'}\n\`\`\``,
                    inline: false
                });

            // Show configured tiers
            const configuredTiers = tierInfo.filter(t => t.isConfigured);
            if (configuredTiers.length > 0) {
                let tierText = '';
                for (const tier of configuredTiers) {
                    const role = interaction.guild.roles.cache.get(tier.roleId);
                    const roleName = role ? role.name : 'Unknown Role';
                    const bonus = tier.cap - validation.baseCap;
                    
                    tierText += `**Tier ${tier.tier}:** ${roleName}\n`;
                    tierText += `\`\`\`yaml\nDaily Cap: ${tier.cap.toLocaleString()} XP\nBonus: +${bonus.toLocaleString()} XP\n\`\`\`\n`;
                }

                embed.addFields({
                    name: '✅ Active Tier Roles',
                    value: tierText,
                    inline: false
                });
            }

            // Show configuration issues
            if (!validation.valid) {
                embed.addFields({
                    name: '⚠️ Configuration Issues',
                    value: validation.issues.map(issue => `• ${issue}`).join('\n'),
                    inline: false
                });
            }

            // Show tier users currently online
            const currentUsers = await xpManager.dailyCapManager.getDailyLeaderboard(interaction.guild.id, 20);
            const tierUsers = currentUsers.filter(u => u.tierLevel > 0);
            
            if (tierUsers.length > 0) {
                let tierUsersText = '';
                for (const user of tierUsers.slice(0, 5)) {
                    try {
                        const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
                        const displayName = member ? member.displayName : 'Unknown User';
                        tierUsersText += `• ${displayName}: Tier ${user.tierLevel} (${user.dailyCap.toLocaleString()} XP cap)\n`;
                    } catch (error) {
                        console.error(`[DAILY] Error fetching tier user ${user.userId}:`, error);
                    }
                }
                
                if (tierUsers.length > 5) {
                    tierUsersText += `*...and ${tierUsers.length - 5} more*`;
                }

                embed.addFields({
                    name: '👥 Active Tier Users Today',
                    value: tierUsersText || 'None active today',
                    inline: false
                });
            }

            embed.setFooter({ 
                text: '⚓ Marine Intelligence Division • Tier System'
            })
            .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[DAILY] Error in tier info view:', error);
            await interaction.editReply({
                content: '❌ **Error**\n\nFailed to load tier information. Please try again.'
            });
        }
    },

    /**
     * Create progress bar visualization
     */
    createProgressBar(percentage, length = 20) {
        const filled = Math.round((percentage / 100) * length);
        const empty = length - filled;
        
        const filledChar = '█';
        const emptyChar = '░';
        
        return filledChar.repeat(filled) + emptyChar.repeat(empty);
    },

    /**
     * Get time until reset in human readable format
     */
    getTimeUntilReset(resetTimestamp) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const timeUntil = resetTimestamp - now;
            
            if (timeUntil <= 0) {
                return 'Soon';
            }
            
            const hours = Math.floor(timeUntil / 3600);
            const minutes = Math.floor((timeUntil % 3600) / 60);
            
            if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else {
                return `${minutes}m`;
            }
        } catch (error) {
            return 'Unknown';
        }
    }
};
