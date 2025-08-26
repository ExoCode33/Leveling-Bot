const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('🔧 Configure server XP settings (Administrator only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('What setting would you like to change?')
                .setRequired(true)
                .addChoices(
                    { name: '📢 Set Level Up Channel', value: 'levelup-channel' },
                    { name: '📊 Set XP Log Channel', value: 'xp-log-channel' },
                    { name: '🔄 Disable Level Up Announcements', value: 'disable-levelup' },
                    { name: '🔄 Disable XP Logging', value: 'disable-xp-logs' },
                    { name: '👁️ View Current Settings', value: 'view' }
                )
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to use (for setting channels)')
                .setRequired(false)
                .addChannelTypes(0) // Text channels only
        ),

    async execute(interaction, { xpManager, databaseManager }) {
        try {
            // Check administrator permissions
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '❌ **Access Denied**\n\nYou need Administrator permissions to use this command.',
                    ephemeral: true
                });
            }

            const action = interaction.options.getString('action');
            const channel = interaction.options.getChannel('channel');
            const guildId = interaction.guild.id;

            switch (action) {
                case 'levelup-channel':
                    if (!channel) {
                        return await interaction.reply({
                            content: '❌ **Missing Parameter**\n\nPlease specify a channel for level up announcements.',
                            ephemeral: true
                        });
                    }

                    if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks', 'AttachFiles'])) {
                        return await interaction.reply({
                            content: `❌ **Permission Error**\n\nI don't have permission to send messages/embeds/files in ${channel}.`,
                            ephemeral: true
                        });
                    }

                    // Update guild settings in database
                    await databaseManager.updateGuildSetting(guildId, 'levelup_channel', channel.id);
                    await databaseManager.updateGuildSetting(guildId, 'levelup_enabled', true);

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ Level Up Channel Updated')
                            .setDescription(`Level up announcements will now be sent to ${channel}\n\n*Level up announcements have been automatically enabled.*`)
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'xp-log-channel':
                    if (!channel) {
                        return await interaction.reply({
                            content: '❌ **Missing Parameter**\n\nPlease specify a channel for XP activity logs.',
                            ephemeral: true
                        });
                    }

                    if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
                        return await interaction.reply({
                            content: `❌ **Permission Error**\n\nI don't have permission to send messages/embeds in ${channel}.`,
                            ephemeral: true
                        });
                    }

                    // Update guild settings in database
                    await databaseManager.updateGuildSetting(guildId, 'xp_log_channel', channel.id);
                    await databaseManager.updateGuildSetting(guildId, 'xp_log_enabled', true);

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ XP Log Channel Updated')
                            .setDescription(`XP activity logs will now be sent to ${channel}\n\n*XP logging has been automatically enabled.*`)
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'disable-levelup':
                    await databaseManager.updateGuildSetting(guildId, 'levelup_enabled', false);

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#FF6B6B')
                            .setTitle('❌ Level Up Announcements Disabled')
                            .setDescription('Level up announcements are now **disabled**.')
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'disable-xp-logs':
                    await databaseManager.updateGuildSetting(guildId, 'xp_log_enabled', false);

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#FF6B6B')
                            .setTitle('❌ XP Logging Disabled')
                            .setDescription('XP activity logging is now **disabled**.')
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'view':
                    return await this.handleViewSettings(interaction, databaseManager, guildId);

                default:
                    return await interaction.reply({
                        content: '❌ **Unknown Action**\n\nPlease use a valid action from the dropdown.',
                        ephemeral: true
                    });
            }

        } catch (error) {
            console.error('Settings command error:', error);
            
            if (!interaction.replied) {
                return await interaction.reply({
                    content: '❌ **Error**\n\nSomething went wrong while updating settings. Please try again.',
                    ephemeral: true
                });
            }
        }
    },

    /**
     * Handle view settings
     */
    async handleViewSettings(interaction, databaseManager, guildId) {
        try {
            const guildSettings = await databaseManager.getGuildSettings(guildId);
            
            const embed = new EmbedBuilder()
                .setColor('#4A90E2')
                .setTitle('🔧 Server XP Settings')
                .setDescription('Current configuration for this server')
                .addFields(
                    {
                        name: '📢 Level Up Announcements',
                        value: `**Status:** ${guildSettings?.levelup_enabled ? '✅ Enabled' : '❌ Disabled'}\n**Channel:** ${guildSettings?.levelup_channel ? `<#${guildSettings.levelup_channel}>` : '❌ Not Set'}`,
                        inline: false
                    },
                    {
                        name: '📊 XP Activity Logging',
                        value: `**Status:** ${guildSettings?.xp_log_enabled ? '✅ Enabled' : '❌ Disabled'}\n**Channel:** ${guildSettings?.xp_log_channel ? `<#${guildSettings.xp_log_channel}>` : '❌ Not Set'}`,
                        inline: false
                    },
                    {
                        name: '⚙️ XP Configuration',
                        value: `**Message XP:** ${process.env.MESSAGE_XP_MIN || 75}-${process.env.MESSAGE_XP_MAX || 100} per message\n**Voice XP:** ${process.env.VOICE_XP_MIN || 250}-${process.env.VOICE_XP_MAX || 350} per 5 minutes\n**Reaction XP:** ${process.env.REACTION_XP_MIN || 75}-${process.env.REACTION_XP_MAX || 100} per reaction\n**Daily Cap:** ${parseInt(process.env.DAILY_XP_CAP || 15000).toLocaleString()} XP`,
                        inline: false
                    },
                    {
                        name: '🏆 Level System',
                        value: `**Max Level:** ${process.env.MAX_LEVEL || 50}\n**Formula:** ${process.env.FORMULA_CURVE || 'exponential'}\n**Multiplier:** ${process.env.FORMULA_MULTIPLIER || 1.75}x\n**Global Multiplier:** ${process.env.XP_MULTIPLIER || 1.0}x`,
                        inline: false
                    },
                    {
                        name: '🎯 Tier Bonuses',
                        value: this.getTierBonusInfo(),
                        inline: false
                    }
                )
                .setFooter({ text: '⚓ Marine Intelligence • Settings Overview' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('[SETTINGS] Error in view settings:', error);
            
            const embed = new EmbedBuilder()
                .setColor('#4A90E2')
                .setTitle('🔧 Server XP Settings')
                .setDescription('Current configuration for this server')
                .addFields({
                    name: '⚠️ Error',
                    value: 'Could not load settings information. Please try again.',
                    inline: false
                })
                .setFooter({ text: '⚓ Marine Intelligence • Settings Overview' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }
    },

    /**
     * Get tier bonus information
     */
    getTierBonusInfo() {
        let tierInfo = '';
        let foundTiers = 0;
        
        for (let tier = 1; tier <= 10; tier++) {
            const roleId = process.env[`TIER_${tier}_ROLE`];
            const capAmount = process.env[`TIER_${tier}_XP_CAP`];
            
            if (roleId && capAmount && roleId !== '' && capAmount !== '') {
                tierInfo += `**Tier ${tier}:** ${parseInt(capAmount).toLocaleString()} XP daily cap\n`;
                foundTiers++;
                
                if (foundTiers >= 5) {
                    if (tier < 10) {
                        tierInfo += `*...and ${10 - tier} more tiers*\n`;
                    }
                    break;
                }
            }
        }
        
        if (foundTiers === 0) {
            tierInfo = 'No tier roles configured\nConfigure TIER_X_ROLE and TIER_X_XP_CAP in environment variables';
        }
        
        return tierInfo;
    }
};
