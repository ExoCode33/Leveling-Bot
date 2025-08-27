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
                    { name: '⚡ Add XP Boost Role', value: 'add-boost-role' },
                    { name: '❌ Remove XP Boost Role', value: 'remove-boost-role' },
                    { name: '🧹 Clear All Boost Roles', value: 'clear-boost-roles' },
                    { name: '👁️ View Current Settings', value: 'view' }
                )
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to use (for setting channels)')
                .setRequired(false)
                .addChannelTypes(0) // Text channels only
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role for XP boost configuration')
                .setRequired(false)
        )
        .addNumberOption(option =>
            option
                .setName('multiplier')
                .setDescription('XP multiplier for the role (e.g., 1.5 = 50% more XP)')
                .setRequired(false)
                .setMinValue(0.1)
                .setMaxValue(5.0)
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
            const role = interaction.options.getRole('role');
            const multiplier = interaction.options.getNumber('multiplier');
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

                case 'add-boost-role':
                    return await this.handleAddBoostRole(interaction, databaseManager, guildId, role, multiplier);

                case 'remove-boost-role':
                    return await this.handleRemoveBoostRole(interaction, databaseManager, guildId, role);

                case 'clear-boost-roles':
                    return await this.handleClearBoostRoles(interaction, databaseManager, guildId);

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
     * Handle adding XP boost role
     */
    async handleAddBoostRole(interaction, databaseManager, guildId, role, multiplier) {
        if (!role) {
            return await interaction.reply({
                content: '❌ **Missing Parameter**\n\nPlease specify a role for XP boost.',
                ephemeral: true
            });
        }

        if (!multiplier) {
            return await interaction.reply({
                content: '❌ **Missing Parameter**\n\nPlease specify an XP multiplier (e.g., 1.5 for 50% boost).',
                ephemeral: true
            });
        }

        if (multiplier < 0.1 || multiplier > 5.0) {
            return await interaction.reply({
                content: '❌ **Invalid Multiplier**\n\nMultiplier must be between 0.1 and 5.0.',
                ephemeral: true
            });
        }

        try {
            // Get current boost roles
            const currentBoosts = await this.getBoostRoles(databaseManager, guildId);
            
            // Check if role already exists
            if (currentBoosts.some(boost => boost.role_id === role.id)) {
                return await interaction.reply({
                    content: '❌ **Role Already Configured**\n\nThis role already has an XP boost. Remove it first to change the multiplier.',
                    ephemeral: true
                });
            }

            // Add new boost role
            await databaseManager.updateGuildSetting(guildId, 'xp_boost_roles', JSON.stringify([
                ...currentBoosts,
                { role_id: role.id, multiplier: multiplier }
            ]));

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('⚡ XP Boost Role Added')
                .setDescription(`**${role.name}** now provides **${multiplier}x** XP multiplier!`)
                .addFields({
                    name: '📋 Details',
                    value: `**Role:** ${role.name}\n**Multiplier:** ${multiplier}x (${Math.round((multiplier - 1) * 100)}% boost)\n**Stacks:** Yes, with other boost roles`,
                    inline: false
                })
                .setFooter({ text: '⚓ Marine Intelligence • XP Boost System' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Add boost role error:', error);
            return await interaction.reply({
                content: '❌ **Operation Failed**\n\nFailed to add XP boost role. Please try again.',
                ephemeral: true
            });
        }
    },

    /**
     * Handle removing XP boost role
     */
    async handleRemoveBoostRole(interaction, databaseManager, guildId, role) {
        if (!role) {
            return await interaction.reply({
                content: '❌ **Missing Parameter**\n\nPlease specify a role to remove from XP boost.',
                ephemeral: true
            });
        }

        try {
            // Get current boost roles
            const currentBoosts = await this.getBoostRoles(databaseManager, guildId);
            
            // Check if role exists
            const roleBoost = currentBoosts.find(boost => boost.role_id === role.id);
            if (!roleBoost) {
                return await interaction.reply({
                    content: '❌ **Role Not Found**\n\nThis role is not configured for XP boost.',
                    ephemeral: true
                });
            }

            // Remove the role
            const updatedBoosts = currentBoosts.filter(boost => boost.role_id !== role.id);
            await databaseManager.updateGuildSetting(guildId, 'xp_boost_roles', JSON.stringify(updatedBoosts));

            const embed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('❌ XP Boost Role Removed')
                .setDescription(`**${role.name}** no longer provides XP boost.`)
                .addFields({
                    name: '📋 Removed Details',
                    value: `**Role:** ${role.name}\n**Previous Multiplier:** ${roleBoost.multiplier}x`,
                    inline: false
                })
                .setFooter({ text: '⚓ Marine Intelligence • XP Boost System' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Remove boost role error:', error);
            return await interaction.reply({
                content: '❌ **Operation Failed**\n\nFailed to remove XP boost role. Please try again.',
                ephemeral: true
            });
        }
    },

    /**
     * Handle clearing all boost roles
     */
    async handleClearBoostRoles(interaction, databaseManager, guildId) {
        try {
            // Get current boost roles
            const currentBoosts = await this.getBoostRoles(databaseManager, guildId);
            
            if (currentBoosts.length === 0) {
                return await interaction.reply({
                    content: '❌ **No Boost Roles**\n\nThere are no XP boost roles configured.',
                    ephemeral: true
                });
            }

            // Clear all boost roles
            await databaseManager.updateGuildSetting(guildId, 'xp_boost_roles', JSON.stringify([]));

            const embed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('🧹 All XP Boost Roles Cleared')
                .setDescription(`Removed ${currentBoosts.length} XP boost role(s).`)
                .addFields({
                    name: '📋 Cleared Roles',
                    value: currentBoosts.map(boost => {
                        const role = interaction.guild.roles.cache.get(boost.role_id);
                        return `**${role?.name || 'Unknown Role'}:** ${boost.multiplier}x`;
                    }).join('\n') || 'None',
                    inline: false
                })
                .setFooter({ text: '⚓ Marine Intelligence • XP Boost System' })
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Clear boost roles error:', error);
            return await interaction.reply({
                content: '❌ **Operation Failed**\n\nFailed to clear XP boost roles. Please try again.',
                ephemeral: true
            });
        }
    },

    /**
     * Handle view settings
     */
    async handleViewSettings(interaction, databaseManager, guildId) {
        try {
            const guildSettings = await databaseManager.getGuildSettings(guildId);
            const boostRoles = await this.getBoostRoles(databaseManager, guildId);
            
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
                        name: '⚡ XP Boost Roles',
                        value: this.getBoostRolesInfo(boostRoles, interaction.guild),
                        inline: false
                    },
                    {
                        name: '🎯 Tier Bonuses (Daily Cap)',
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
     * Get XP boost roles from database
     */
    async getBoostRoles(databaseManager, guildId) {
        try {
            const guildSettings = await databaseManager.getGuildSettings(guildId);
            const boostRolesJson = guildSettings?.xp_boost_roles;
            
            if (!boostRolesJson) return [];
            
            const boostRoles = JSON.parse(boostRolesJson);
            return Array.isArray(boostRoles) ? boostRoles : [];
        } catch (error) {
            console.error('Error getting boost roles:', error);
            return [];
        }
    },

    /**
     * Get boost roles information for display
     */
    getBoostRolesInfo(boostRoles, guild) {
        if (boostRoles.length === 0) {
            return 'No XP boost roles configured\nUse `/settings action:Add XP Boost Role` to add roles';
        }

        let info = '';
        let totalMultiplier = 1.0;
        
        for (const boost of boostRoles) {
            const role = guild.roles.cache.get(boost.role_id);
            const roleName = role ? role.name : 'Unknown Role';
            const percentage = Math.round((boost.multiplier - 1) * 100);
            
            info += `**${roleName}:** ${boost.multiplier}x (+${percentage}%)\n`;
            totalMultiplier += (boost.multiplier - 1); // Additive multipliers
        }
        
        if (boostRoles.length > 1) {
            const totalPercentage = Math.round((totalMultiplier - 1) * 100);
            info += `\n**Combined Effect:** ${totalMultiplier.toFixed(2)}x (+${totalPercentage}%)`;
        }
        
        info += '\n\n*Note: Boost roles stack additively and don\'t affect daily caps*';
        
        return info;
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
        } else {
            tierInfo += '\n*Note: Tier roles only affect daily caps, not XP multipliers*';
        }
        
        return tierInfo;
    }
};
