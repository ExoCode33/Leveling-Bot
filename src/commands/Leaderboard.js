const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

// Admin user ID from environment
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '1095470472390508658';
// Commands channel restriction
const COMMANDS_CHANNEL = process.env.COMMANDS_CHANNEL || null;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show server leaderboard with wanted posters')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of leaderboard to show')
                .setRequired(false)
                .addChoices(
                    { name: 'Top 3 Bounties', value: 'posters' },
                    { name: 'Top 10 Bounties', value: 'long' },
                    { name: 'All The Bounties', value: 'full' }
                )),

    async execute(interaction, { xpManager, databaseManager, cacheManager, connectionManager }) {
        try {
            // Check if this is a button interaction or regular slash command
            const isButtonInteraction = interaction.isButton();
            const isSlashCommand = interaction.isChatInputCommand();

            if (!isButtonInteraction && !isSlashCommand) {
                console.error('[LEADERBOARD] Unknown interaction type:', interaction.type);
                return;
            }

            console.log(`[LEADERBOARD] Processing ${isButtonInteraction ? 'button' : 'slash'} interaction`);

            // Check channel restriction (admin can use anywhere)
            if (interaction.user.id !== ADMIN_USER_ID && COMMANDS_CHANNEL && interaction.channel.id !== COMMANDS_CHANNEL) {
                const errorMessage = `❌ **Channel Restriction**\n\nThis command can only be used in <#${COMMANDS_CHANNEL}>.`;
                
                if (isButtonInteraction) {
                    return await interaction.update({
                        content: errorMessage,
                        embeds: [],
                        components: []
                    });
                } else {
                    return await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });
                }
            }

            // Get type from button interaction or slash command
            let type;
            if (isButtonInteraction) {
                type = interaction.customId.replace('leaderboard_', '');
                console.log(`[LEADERBOARD] Button interaction for type: ${type}`);
            } else {
                type = interaction.options.getString('type') || 'posters';
                console.log(`[LEADERBOARD] Slash command for type: ${type}`);
            }

            // Defer reply - handle both interaction types
            if (isButtonInteraction) {
                await interaction.deferUpdate();
                console.log('[LEADERBOARD] Button interaction deferred');
            } else {
                await interaction.deferReply();
                console.log('[LEADERBOARD] Slash command deferred');
            }

            // Get leaderboard data with automatic validation and cleanup
            console.log('[LEADERBOARD] Fetching and auto-validating leaderboard data...');
            const { validUsers, removedUsers } = await this.getValidatedLeaderboardWithAutoCleanup(interaction.guild, xpManager, databaseManager);
            
            if (removedUsers > 0) {
                console.log(`[LEADERBOARD] ✅ Auto-cleaned ${removedUsers} users who left the server`);
            }
            
            if (!validUsers || validUsers.length === 0) {
                console.log('[LEADERBOARD] No valid users found in leaderboard');
                
                const embed = new EmbedBuilder()
                    .setTitle('🏴‍☠️ No Active Pirates Found')
                    .setDescription('No pirates are currently active in this server!')
                    .addFields({
                        name: '📋 Possible Reasons',
                        value: '• No users have gained XP yet\n• All users may have left the server\n• Database was automatically cleaned',
                        inline: false
                    })
                    .addFields({
                        name: '🔧 What Happened',
                        value: removedUsers > 0 
                            ? `✅ Automatically removed ${removedUsers} users who left the server` 
                            : '📊 Database is clean - no inactive users found',
                        inline: false
                    })
                    .setColor('#FF6B35');

                if (isButtonInteraction) {
                    return await interaction.editReply({ embeds: [embed], components: [] });
                } else {
                    return await interaction.editReply({ embeds: [embed] });
                }
            }

            console.log(`[LEADERBOARD] Found ${validUsers.length} valid users in leaderboard`);

            // Check for Pirate King
            const excludedRoleId = process.env.LEADERBOARD_EXCLUDE_ROLE;
            let pirateKing = null;
            
            if (excludedRoleId) {
                console.log(`[LEADERBOARD] Checking for Pirate King role: ${excludedRoleId}`);
                const guild = interaction.guild;
                const role = guild.roles.cache.get(excludedRoleId);
                if (role && role.members.size > 0) {
                    const pirateKingMember = role.members.first();
                    if (pirateKingMember) {
                        console.log(`[LEADERBOARD] Found Pirate King: ${pirateKingMember.user.username}`);
                        const BountyCalculator = require('../utils/BountyCalculator');
                        const bountyCalculator = new BountyCalculator();
                        pirateKing = {
                            userId: pirateKingMember.user.id,
                            level: 55,
                            total_xp: 999999999,
                            messages: 0,
                            reactions: 0,
                            voice_time: 0,
                            member: pirateKingMember,
                            isPirateKing: true,
                            bounty: bountyCalculator.getBountyForLevel(55, true)
                        };
                    }
                }
            }

            // Add cleanup success message if users were removed
            if (removedUsers > 0) {
                const cleanupEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setAuthor({ 
                        name: '🧹 AUTOMATIC DATABASE MAINTENANCE'
                    })
                    .setDescription(`\`\`\`diff\n+ AUTO-CLEANUP COMPLETED\n+ Removed ${removedUsers} users who left the server\n+ Leaderboard now shows only active pirates\n+ Database optimized for better performance\n\`\`\``)
                    .setFooter({ text: '⚓ Marine Intelligence • Auto-Maintenance System' });

                await interaction.followUp({ embeds: [cleanupEmbed] });
            }

            // Create navigation buttons
            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('leaderboard_posters')
                        .setLabel('Top 3 Bounties')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('leaderboard_long')
                        .setLabel('Top 10 Bounties')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('leaderboard_full')
                        .setLabel('All The Bounties')
                        .setStyle(ButtonStyle.Danger)
                );

            // Process based on type
            console.log(`[LEADERBOARD] Processing type: ${type}`);
            switch (type) {
                case 'posters':
                    await this.handlePostersLeaderboard(interaction, pirateKing, validUsers, buttons, cacheManager, isButtonInteraction);
                    break;
                case 'long':
                    await this.handleLongLeaderboard(interaction, pirateKing, validUsers, buttons, cacheManager, isButtonInteraction);
                    break;
                case 'full':
                    await this.handleFullLeaderboard(interaction, pirateKing, validUsers, buttons, isButtonInteraction);
                    break;
                default:
                    await this.handlePostersLeaderboard(interaction, pirateKing, validUsers, buttons, cacheManager, isButtonInteraction);
                    break;
            }

        } catch (error) {
            console.error('[ERROR] Error in leaderboard command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Leaderboard Error')
                .setDescription(`Failed to load leaderboard: ${error.message}`)
                .setColor('#FF0000');

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                } else if (interaction.isButton()) {
                    await interaction.update({ embeds: [errorEmbed], components: [] });
                } else {
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            } catch (replyError) {
                console.error('[ERROR] Failed to send error message:', replyError);
            }
        }
    },

    /**
     * Get validated leaderboard data with AUTOMATIC cleanup
     * NO MANUAL SCRIPTS REQUIRED - Everything happens automatically
     */
    async getValidatedLeaderboardWithAutoCleanup(guild, xpManager, databaseManager) {
        try {
            console.log('[LEADERBOARD] Fetching raw leaderboard data...');
            const leaderboardData = await xpManager.getLeaderboard(guild.id, 100);
            
            if (!leaderboardData || leaderboardData.length === 0) {
                return { validUsers: [], removedUsers: 0 };
            }

            console.log(`[LEADERBOARD] Auto-processing ${leaderboardData.length} database entries...`);

            const validUsers = [];
            const invalidUserIds = [];
            const batchSize = 5; // Process in small batches to avoid rate limits

            // Process users in batches for better performance
            for (let i = 0; i < leaderboardData.length; i += batchSize) {
                const batch = leaderboardData.slice(i, i + batchSize);
                
                const batchPromises = batch.map(async (user) => {
                    try {
                        // Try to fetch the member with timeout
                        const member = await Promise.race([
                            guild.members.fetch(user.user_id),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), 5000)
                            )
                        ]).catch(() => null);
                        
                        if (member) {
                            // User is still in server, add to valid users
                            const BountyCalculator = require('../utils/BountyCalculator');
                            const bountyCalculator = new BountyCalculator();
                            
                            return {
                                valid: true,
                                userData: {
                                    ...user,
                                    member,
                                    userId: user.user_id,
                                    bounty: bountyCalculator.getBountyForLevel(user.level)
                                }
                            };
                        } else {
                            // User left the server
                            return {
                                valid: false,
                                userId: user.user_id
                            };
                        }
                    } catch (error) {
                        console.log(`[LEADERBOARD] Error checking user ${user.user_id}: ${error.message}`);
                        return {
                            valid: false,
                            userId: user.user_id
                        };
                    }
                });

                // Wait for batch to complete
                const batchResults = await Promise.all(batchPromises);
                
                // Process results
                for (const result of batchResults) {
                    if (result.valid) {
                        validUsers.push(result.userData);
                        console.log(`[LEADERBOARD] ✅ Valid: ${result.userData.member.user.username}`);
                    } else {
                        invalidUserIds.push(result.userId);
                        console.log(`[LEADERBOARD] ❌ Invalid: ${result.userId} (left server)`);
                    }
                }

                // Small delay between batches
                if (i + batchSize < leaderboardData.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            // AUTOMATIC CLEANUP - Always happens when users are found who left
            let removedUsers = 0;
            if (invalidUserIds.length > 0) {
                console.log(`[LEADERBOARD] 🧹 Auto-cleaning ${invalidUserIds.length} users who left...`);
                
                // Clean up in batches to avoid overwhelming the database
                const cleanupBatchSize = 10;
                for (let i = 0; i < invalidUserIds.length; i += cleanupBatchSize) {
                    const cleanupBatch = invalidUserIds.slice(i, i + cleanupBatchSize);
                    
                    const cleanupPromises = cleanupBatch.map(async (userId) => {
                        try {
                            // Remove from all tables
                            await Promise.all([
                                databaseManager.db.query(
                                    `DELETE FROM ${databaseManager.tables.userLevels} WHERE user_id = $1 AND guild_id = $2`,
                                    [userId, guild.id]
                                ),
                                databaseManager.db.query(
                                    `DELETE FROM ${databaseManager.tables.dailyXP} WHERE user_id = $1 AND guild_id = $2`,
                                    [userId, guild.id]
                                ),
                                databaseManager.db.query(
                                    `DELETE FROM ${databaseManager.tables.voiceSessions} WHERE user_id = $1 AND guild_id = $2`,
                                    [userId, guild.id]
                                )
                            ]);
                            
                            return true; // Success
                        } catch (cleanupError) {
                            console.error(`[LEADERBOARD] Failed to cleanup user ${userId}:`, cleanupError);
                            return false; // Failed
                        }
                    });
                    
                    const cleanupResults = await Promise.all(cleanupPromises);
                    removedUsers += cleanupResults.filter(result => result).length;
                    
                    // Small delay between cleanup batches
                    if (i + cleanupBatchSize < invalidUserIds.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }

                console.log(`[LEADERBOARD] ✅ Auto-cleanup complete: ${removedUsers}/${invalidUserIds.length} users removed`);
            }

            console.log(`[LEADERBOARD] ✅ Auto-validation complete: ${validUsers.length} valid, ${removedUsers} auto-removed`);
            
            return { 
                validUsers: validUsers.slice(0, 50), // Limit to top 50 valid users
                removedUsers 
            };

        } catch (error) {
            console.error('[LEADERBOARD] Error in auto-validation:', error);
            return { validUsers: [], removedUsers: 0 };
        }
    },

    /**
     * Handle Top 3 Bounties (with posters)
     */
    async handlePostersLeaderboard(interaction, pirateKing, validUsers, buttons, cacheManager, isButtonInteraction) {
        try {
            console.log('[LEADERBOARD] Starting Top 3 Bounties generation...');
            
            // Send header
            const headerEmbed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(0xFF0000)
                .addFields({
                    name: '📋 OPERATION BRIEFING',
                    value: `🚨 **TOP 3 MOST WANTED PIRATES** 🚨\n\n\`\`\`diff\n- MARINE INTELLIGENCE DIRECTIVE:\n- The following individuals represent the highest threat\n- levels currently under surveillance. Immediate\n- response protocols are authorized for any sightings.\n- Database auto-cleaned for accuracy\n\`\`\``,
                    inline: false
                });

            await interaction.editReply({ embeds: [headerEmbed] });

            // Get Level 1+ users only
            const level1PlusUsers = validUsers.filter(user => user.level >= 1);
            const postersToShow = [];
            
            if (pirateKing) postersToShow.push(pirateKing);
            postersToShow.push(...level1PlusUsers.slice(0, 3));

            console.log(`[LEADERBOARD] Will generate ${postersToShow.length} posters for Top 3`);

            if (postersToShow.length === 0) {
                const noPostersEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🏴‍☠️ No Wanted Pirates Found')
                    .setDescription('No pirates have reached Level 1+ yet in this server!')
                    .addFields({
                        name: '📋 Requirements',
                        value: 'Pirates must reach at least Level 1 to appear on wanted posters.',
                        inline: false
                    })
                    .addFields({
                        name: '✨ Auto-Maintenance',
                        value: 'Database was automatically cleaned to show only active users.',
                        inline: false
                    });

                return await interaction.followUp({ 
                    embeds: [noPostersEmbed], 
                    components: [buttons] 
                });
            }

            // Initialize canvas generator with cache manager
            const CanvasGenerator = require('../utils/CanvasGenerator');
            const canvasGenerator = new CanvasGenerator(cacheManager);
            
            // Generate and send each poster
            for (let i = 0; i < postersToShow.length; i++) {
                const userData = postersToShow[i];
                const isPirateKingData = userData.isPirateKing || false;
                const rank = isPirateKingData ? 'PIRATE KING' : `RANK ${i + (pirateKing ? 0 : 1)}`;
                
                try {
                    console.log(`[LEADERBOARD] Generating poster ${i + 1}/${postersToShow.length} for ${userData.member.displayName} (${userData.userId})`);
                    
                    const canvas = await canvasGenerator.createWantedPoster(userData, interaction.guild);
                    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `wanted_${userData.userId}.png` });
                    
                    // Create intelligence embed
                    const embed = new EmbedBuilder()
                        .setAuthor({ 
                            name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                        })
                        .setColor(isPirateKingData ? 0xFFD700 : 0xFF0000);

                    const BountyCalculator = require('../utils/BountyCalculator');
                    const bountyCalculator = new BountyCalculator();
                    let intelligenceValue = `\`\`\`diff\n- Alias: ${userData.member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${rank}\n- Threat: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}\n- Activity: ${this.getActivityLevel(userData)}\n- Status: ACTIVE (Auto-Verified)\n\`\`\``;

                    embed.addFields({
                        name: '📊 INTELLIGENCE SUMMARY',
                        value: intelligenceValue,
                        inline: false
                    });

                    if (isPirateKingData) {
                        embed.addFields({
                            name: '👑 SPECIAL CLASSIFICATION',
                            value: `\`\`\`diff\n- EMPEROR STATUS CONFIRMED\n- MAXIMUM THREAT DESIGNATION\n- APPROACH WITH EXTREME CAUTION\n\`\`\``,
                            inline: false
                        });
                    }

                    embed.setImage(`attachment://wanted_${userData.userId}.png`)
                        .setFooter({ 
                            text: `⚓ Marine Intelligence Division • Auto-Verified Active User • Classification: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}`
                        })
                        .setTimestamp();

                    // Add buttons only to the last poster
                    const isLastPoster = (i === postersToShow.length - 1);
                    const messageOptions = { embeds: [embed], files: [attachment] };
                    if (isLastPoster) {
                        messageOptions.components = [buttons];
                    }
                    
                    await interaction.followUp(messageOptions);
                    
                    console.log(`[LEADERBOARD] ✅ Successfully sent poster ${i + 1}/${postersToShow.length} for ${userData.member.displayName}`);
                    
                    // Small delay between posters to prevent rate limiting
                    if (i < postersToShow.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                    
                } catch (error) {
                    console.error(`[ERROR] Failed to create poster for ${userData.member?.displayName || userData.userId}:`, error);
                    
                    // Send error message for this specific poster with fallback info
                    const errorEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setAuthor({ 
                            name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                        })
                        .setTitle('⚠️ POSTER GENERATION FAILED')
                        .setDescription(`Failed to generate wanted poster for **${userData.member.displayName}**`)
                        .addFields(
                            {
                                name: '📊 INTELLIGENCE SUMMARY',
                                value: `\`\`\`diff\n- Alias: ${userData.member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${rank}\n- Status: POSTER GENERATION ERROR\n- Error: ${error.message.substring(0, 50)}...\n\`\`\``,
                                inline: false
                            }
                        )
                        .setFooter({ 
                            text: '⚓ Marine Intelligence Division • System Error'
                        })
                        .setTimestamp();

                    const isLastPoster = (i === postersToShow.length - 1);
                    const messageOptions = { embeds: [errorEmbed] };
                    if (isLastPoster) {
                        messageOptions.components = [buttons];
                    }
                    
                    await interaction.followUp(messageOptions);
                }
            }

            console.log('[LEADERBOARD] ✅ Completed Top 3 Bounties generation');

        } catch (error) {
            console.error('[ERROR] Error in handlePostersLeaderboard:', error);
            throw error;
        }
    },

    /**
     * Handle Top 10 Bounties (with posters) 
     */
    async handleLongLeaderboard(interaction, pirateKing, validUsers, buttons, cacheManager, isButtonInteraction) {
        try {
            console.log('[LEADERBOARD] Starting Top 10 Bounties generation...');
            
            // Send header
            const headerEmbed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(0xFF0000)
                .addFields({
                    name: '📋 EXTENDED OPERATION BRIEFING',
                    value: `🚨 **TOP 10 MOST WANTED PIRATES** 🚨\n\n\`\`\`diff\n- EXTENDED SURVEILLANCE REPORT:\n- This comprehensive assessment covers the ten most\n- dangerous pirates currently under Marine observation.\n- All personnel are advised to review threat profiles\n- and maintain heightened alert status.\n- Database auto-verified for accuracy\n\`\`\``,
                    inline: false
                });

            await interaction.editReply({ embeds: [headerEmbed] });

            // Get Level 1+ users only
            const level1PlusUsers = validUsers.filter(user => user.level >= 1);
            const postersToShow = [];
            
            if (pirateKing) postersToShow.push(pirateKing);
            postersToShow.push(...level1PlusUsers.slice(0, 10));

            if (postersToShow.length === 0) {
                const noPostersEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🏴‍☠️ No Wanted Pirates Found')
                    .setDescription('No pirates have reached Level 1+ yet in this server!')
                    .addFields({
                        name: '✨ Auto-Maintenance Complete',
                        value: 'Database automatically cleaned to show only active users.',
                        inline: false
                    });

                return await interaction.followUp({ 
                    embeds: [noPostersEmbed], 
                    components: [buttons] 
                });
            }

            // Initialize canvas generator and generate posters
            const CanvasGenerator = require('../utils/CanvasGenerator');
            const canvasGenerator = new CanvasGenerator(cacheManager);
            
            for (let i = 0; i < postersToShow.length; i++) {
                const userData = postersToShow[i];
                const isPirateKingData = userData.isPirateKing || false;
                const rank = isPirateKingData ? 'PIRATE KING' : `RANK ${i + (pirateKing ? 0 : 1)}`;
                
                try {
                    const canvas = await canvasGenerator.createWantedPoster(userData, interaction.guild);
                    const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `wanted_${userData.userId}.png` });
                    
                    const embed = new EmbedBuilder()
                        .setAuthor({ 
                            name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                        })
                        .setColor(isPirateKingData ? 0xFFD700 : 0xFF0000);

                    const BountyCalculator = require('../utils/BountyCalculator');
                    const bountyCalculator = new BountyCalculator();
                    
                    embed.addFields({
                        name: '📊 INTELLIGENCE SUMMARY',
                        value: `\`\`\`diff\n- Alias: ${userData.member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${rank}\n- Threat: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}\n- Activity: ${this.getActivityLevel(userData)}\n- Status: ACTIVE (Auto-Verified)\n\`\`\``,
                        inline: false
                    });

                    embed.setImage(`attachment://wanted_${userData.userId}.png`)
                        .setFooter({ 
                            text: `⚓ Marine Intelligence Division • Auto-Verified Active User`
                        })
                        .setTimestamp();

                    const isLastPoster = (i === postersToShow.length - 1);
                    const messageOptions = { embeds: [embed], files: [attachment] };
                    if (isLastPoster) {
                        messageOptions.components = [buttons];
                    }
                    
                    await interaction.followUp(messageOptions);
                    
                    if (i < postersToShow.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                    
                } catch (error) {
                    console.error(`[ERROR] Failed to create poster for ${userData.member?.displayName}:`, error);
                }
            }

        } catch (error) {
            console.error('[ERROR] Error in handleLongLeaderboard:', error);
            throw error;
        }
    },

    /**
     * Handle All Bounties (text only)
     */
    async handleFullLeaderboard(interaction, pirateKing, validUsers, buttons, isButtonInteraction) {
        try {
            const level1Plus = validUsers.filter(user => user.level >= 1);
            
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(0xFF0000);

            // Add header info
            let headerInfo = `\`\`\`diff\n- COMPLETE SURVEILLANCE DATABASE\n- Active Threats: ${level1Plus.length + (pirateKing ? 1 : 0)}\n- Last Updated: ${new Date().toLocaleString()}\n- Civilian Count: ${validUsers.filter(user => user.level === 0).length}\n- Total Active Users: ${validUsers.length}\n- Status: AUTO-VERIFIED ACTIVE USERS\n\`\`\``;
            
            embed.addFields({
                name: '📊 DATABASE STATUS',
                value: headerInfo,
                inline: false
            });

            if (level1Plus.length === 0 && !pirateKing) {
                embed.addFields({
                    name: '🏴‍☠️ ACTIVE THREATS',
                    value: '```diff\n- NO ACTIVE THREATS DETECTED\n- All users are below Level 1\n- Database auto-cleaned for accuracy\n- Continue monitoring for criminal activity\n```',
                    inline: false
                });
            } else {
                // Add pirates in manageable chunks
                const chunkSize = 10;
                for (let i = 0; i < level1Plus.length; i += chunkSize) {
                    const chunk = level1Plus.slice(i, i + chunkSize);
                    let chunkValue = `\`\`\`diff\n`;
                    
                    chunk.forEach((user, index) => {
                        const globalIndex = i + index + 1;
                        const BountyCalculator = require('../utils/BountyCalculator');
                        const bountyCalculator = new BountyCalculator();
                        const threatLevel = bountyCalculator.getThreatLevelName(user.level);
                        
                        chunkValue += `+ ${String(globalIndex).padStart(2, '0')}. ${user.member.displayName} (ACTIVE)\n`;
                        chunkValue += `+     ฿${user.bounty.toLocaleString()} | Lv.${user.level}\n`;
                        chunkValue += `+     ${threatLevel.substring(0, 15)}\n\n`;
                    });
                    chunkValue += `\`\`\``;

                    embed.addFields({
                        name: i === 0 ? '🏴‍☠️ ACTIVE THREATS (AUTO-VERIFIED)' : `🏴‍☠️ CONTINUED (Page ${Math.floor(i/chunkSize) + 1})`,
                        value: chunkValue,
                        inline: false
                    });
                }
            }

            embed.setFooter({ 
                text: `⚓ Marine Intelligence Division • ${level1Plus.length + (pirateKing ? 1 : 0)} Auto-Verified Active Profiles`
            })
            .setTimestamp();

            await interaction.editReply({ 
                embeds: [embed], 
                components: [buttons] 
            });

        } catch (error) {
            console.error('[ERROR] Error in handleFullLeaderboard:', error);
            throw error;
        }
    },

    /**
     * Get activity level description
     */
    getActivityLevel(userData) {
        const totalActivity = (userData.messages || 0) + (userData.reactions || 0) + Math.floor((userData.voice_time || 0) / 60);
        
        if (totalActivity > 1000) return 'HIGH';
        if (totalActivity > 500) return 'MODERATE';
        if (totalActivity > 100) return 'LOW';
        return 'MINIMAL';
    }
};
