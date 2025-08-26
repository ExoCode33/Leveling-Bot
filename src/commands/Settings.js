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
                    { name: '🔄 Toggle Level Up Announcements', value: 'toggle-levelup' },
                    { name: '🔄 Toggle XP Logging', value: 'toggle-xp-logs' },
                    { name: '👁️ View Current Settings', value: 'view' }
                )
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to use (for levelup-channel or xp-log-channel)')
                .setRequired(false)
                .addChannelTypes(0)
        )
        .addBooleanOption(option =>
            option
                .setName('enabled')
                .setDescription('Enable or disable (for toggle options)')
                .setRequired(false)
        ),

    async execute(interaction, { xpManager, databaseManager }) {
        try {
            // Double-check administrator permissions
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await interaction.reply({
                    content: '❌ **Access Denied**\n\nYou need Administrator permissions to use this command.',
                    ephemeral: true
                });
            }

            const action = interaction.options.getString('action');
            const channel = interaction.options.getChannel('channel');
            const enabled = interaction.options.getBoolean('enabled');
            const guildId = interaction.guild.id;

            switch (action) {
                case 'levelup-channel':
                    if (!channel) {
                        return await interaction.reply({
                            content: '❌ **Missing Parameter**\n\nPlease specify a channel for level up announcements.',
                            ephemeral: true
                        });
                    }

                    if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
                        return await interaction.reply({
                            content: `❌ **Permission Error**\n\nI don't have permission to send messages in ${channel}.`,
                            ephemeral: true
                        });
                    }

                    // Save to environment (in production, this would be saved to database/config)
                    process.env.LEVELUP_CHANNEL = channel.id;
                    process.env.LEVELUP_ENABLED = 'true';

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ Level Up Channel Updated')
                            .setDescription(`Level up announcements will now be sent to ${channel}`)
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
                            content: `❌ **Permission Error**\n\nI don't have permission to send messages in ${channel}.`,
                            ephemeral: true
                        });
                    }

                    // Save to environment (in production, this would be saved to database/config)
                    process.env.XP_LOG_CHANNEL = channel.id;
                    process.env.XP_LOG_ENABLED = 'true';

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ XP Log Channel Updated')
                            .setDescription(`XP activity logs will now be sent to ${channel}\n\n*XP logging has been automatically enabled.*`)
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'toggle-levelup':
                    if (enabled === null) {
                        return await interaction.reply({
                            content: '❌ **Missing Parameter**\n\nPlease specify whether to enable or disable level up announcements.',
                            ephemeral: true
                        });
                    }

                    process.env.LEVELUP_ENABLED = enabled.toString();

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor(enabled ? '#00FF00' : '#FF6B6B')
                            .setTitle(`${enabled ? '✅' : '❌'} Level Up Announcements ${enabled ? 'Enabled' : 'Disabled'}`)
                            .setDescription(enabled ? 
                                'Level up announcements are now **enabled**.' :
                                'Level up announcements are now **disabled**.'
                            )
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'toggle-xp-logs':
                    if (enabled === null) {
                        return await interaction.reply({
                            content: '❌ **Missing Parameter**\n\nPlease specify whether to enable or disable XP logging.',
                            ephemeral: true
                        });
                    }

                    if (enabled && !process.env.XP_LOG_CHANNEL) {
                        return await interaction.reply({
                            content: '❌ **Configuration Error**\n\nYou must set an XP log channel first.',
                            ephemeral: true
                        });
                    }
                    
                    process.env.XP_LOG_ENABLED = enabled.toString();

                    return await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setColor(enabled ? '#00FF00' : '#FF6B6B')
                            .setTitle(`${enabled ? '✅' : '❌'} XP Logging ${enabled ? 'Enabled' : 'Disabled'}`)
                            .setDescription(enabled ? 
                                'XP activity logging is now **enabled**.' :
                                'XP activity logging is now **disabled**.'
                            )
                            .setFooter({ text: '⚓ Marine Intelligence • Settings Updated' })
                            .setTimestamp()
                        ]
                    });

                case 'view':
                    return await this.handleViewSettings(interaction);

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
    async handleViewSettings(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#4A90E2')
                .setTitle('🔧 Server XP Settings')
                .setDescription('Current configuration for this server')
                .addFields(
                    {
                        name: '📢 Level Up Announcements',
                        value: `**Status:** ${process.env.LEVELUP_ENABLED === 'true' ? '✅ Enabled' : '❌ Disabled'}\n**Channel:** ${process.env.LEVELUP_CHANNEL ? `<#${process.env.LEVELUP_CHANNEL}>` : '❌ Not Set'}`,
                        inline: false
                    },
                    {
                        name: '📊 XP Activity Logging',
                        value: `**Status:** ${process.env.XP_LOG_ENABLED === 'true' ? '✅ Enabled' : '❌ Disabled'}\n**Channel:** ${process.env.XP_LOG_CHANNEL ? `<#${process.env.XP_LOG_CHANNEL}>` : '❌ Not Set'}`,
                        inline: false
                    },
                    {
                        name: '⚙️ XP Configuration',
                        value: `**Message XP:** ${process.env.MESSAGE_XP_MIN || 75}-${process.env.MESSAGE_XP_MAX || 100} per message\n**Voice XP:** ${process.env.VOICE_XP_MIN || 250}-${process.env.VOICE_XP_MAX || 350} per minute\n**Reaction XP:** ${process.env.REACTION_XP_MIN || 75}-${process.env.REACTION_XP_MAX || 100} per reaction\n**Daily Cap:** ${parseInt(process.env.DAILY_XP_CAP || 15000).toLocaleString()} XP`,
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
                .addFields(
                    {
                        name: '📢 Level Up Announcements',
                        value: `**Status:** ${process.env.LEVELUP_ENABLED === 'true' ? '✅ Enabled' : '❌ Disabled'}`,
                        inline: false
                    },
                    {
                        name: '📊 XP Activity Logging',
                        value: `**Status:** ${process.env.XP_LOG_ENABLED === 'true' ? '✅ Enabled' : '❌ Disabled'}`,
                        inline: false
                    },
                    {
                        name: '⚠️ Error',
                        value: 'Could not load all settings information',
                        inline: false
                    }
                )
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
            
            if (roleId && capAmount && roleId !== `role_id_${tier}`) {
                const guild = global.client?.guilds?.cache?.first();
                const role = guild?.roles?.cache?.get(roleId);
                const roleName = role ? role.name : `Tier ${tier} Role`;
                
                tierInfo += `**${roleName}:** ${parseInt(capAmount).toLocaleString()} XP cap\n`;
                foundTiers++;
                
                // Limit display to prevent overflow
                if (foundTiers >= 5) {
                    if (tier < 10) {
                        tierInfo += `*...and ${10 - tier} more tiers*\n`;
                    }
                    break;
                }
            }
        }
        
        if (foundTiers === 0) {
            tierInfo = 'No tier roles configured\
