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

            // Get leaderboard data
            console.log('[LEADERBOARD] Fetching leaderboard data...');
            const leaderboardData = await xpManager.getLeaderboard(interaction.guild.id, 50);
            
            if (!leaderboardData || leaderboardData.length === 0) {
                console.log('[LEADERBOARD] No leaderboard data found');
                
                const embed = new EmbedBuilder()
                    .setTitle('🏴‍☠️ No Bounties Found')
                    .setDescription('No pirates have earned bounties yet!')
                    .setColor('#FF6B35');

                if (isButtonInteraction) {
                    return await interaction.editReply({ embeds: [embed], components: [] });
                } else {
                    return await interaction.editReply({ embeds: [embed] });
                }
            }

            console.log(`[LEADERBOARD] Found ${leaderboardData.length} users in leaderboard`);

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

            // Filter out excluded role users from regular list
            console.log('[LEADERBOARD] Processing user data and fetching members...');
            const filteredUsers = [];
            for (const user of leaderboardData) {
                try {
                    const member = await interaction.guild.members.fetch(user.user_id).catch(() => null);
                    if (member) {
                        // Skip users with excluded role (Pirate King)
                        if (excludedRoleId && member.roles.cache.has(excludedRoleId)) {
                            console.log(`[LEADERBOARD] Skipping Pirate King from regular list: ${member.user.username}`);
                            continue;
                        }
                        // Fix the user data structure for canvas generation
                        filteredUsers.push({ 
                            ...user, 
                            member,
                            userId: user.user_id,  // Map user_id to userId for canvas
                            bounty: this.bountyCalculator.getBountyForLevel(user.level)
                        });
                    }
                } catch (error) {
                    console.log(`[LEADERBOARD] Could not fetch member: ${user.user_id}`);
                }
            }

            console.log(`[LEADERBOARD] Filtered to ${filteredUsers.length} regular users`);

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
                    await this.handlePostersLeaderboard(interaction, pirateKing, filteredUsers, buttons, cacheManager, isButtonInteraction);
                    break;
                case 'long':
                    await this.handleLongLeaderboard(interaction, pirateKing, filteredUsers, buttons, cacheManager, isButtonInteraction);
                    break;
                case 'full':
                    await this.handleFullLeaderboard(interaction, pirateKing, filteredUsers, buttons, isButtonInteraction);
                    break;
                default:
                    await this.handlePostersLeaderboard(interaction, pirateKing, filteredUsers, buttons, cacheManager, isButtonInteraction);
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
     * Handle Top 3 Bounties (with posters)
     */
    async handlePostersLeaderboard(interaction, pirateKing, filteredUsers, buttons, cacheManager, isButtonInteraction) {
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
                    value: `🚨 **TOP 3 MOST WANTED PIRATES** 🚨\n\n\`\`\`diff\n- MARINE INTELLIGENCE DIRECTIVE:\n- The following individuals represent the highest threat\n- levels currently under surveillance. Immediate\n- response protocols are authorized for any sightings.\n\`\`\``,
                    inline: false
                });

            await interaction.editReply({ embeds: [headerEmbed] });

            // Get Level 1+ users only
            const level1PlusUsers = filteredUsers.filter(user => user.level >= 1);
            const postersToShow = [];
            
            if (pirateKing) postersToShow.push(pirateKing);
            postersToShow.push(...level1PlusUsers.slice(0, 3));

            console.log(`[LEADERBOARD] Will generate ${postersToShow.length} posters for Top 3`);

            if (postersToShow.length === 0) {
                const noPostersEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🏴‍☠️ No Wanted Pirates Found')
                    .setDescription('No pirates have reached Level 1+ yet!')
                    .addFields({
                        name: '📋 Requirements',
                        value: 'Pirates must reach at least Level 1 to appear on wanted posters.',
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
                    console.log(`[LEADERBOARD DEBUG] userData structure:`, {
                        userId: userData.userId,
                        user_id: userData.user_id,
                        level: userData.level,
                        bounty: userData.bounty,
                        memberExists: !!userData.member,
                        memberUsername: userData.member?.user?.username
                    });
                    
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
                    let intelligenceValue = `\`\`\`diff\n- Alias: ${userData.member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${rank}\n- Threat: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}\n- Activity: ${this.getActivityLevel(userData)}\n\`\`\``;

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
                            text: `⚓ Marine Intelligence Division • Classification: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}`
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
                            },
                            {
                                name: '❌ Technical Details',
                                value: `**Error Type:** Canvas Generation Failure\n**User ID:** ${userData.userId}\n**Level:** ${userData.level}\n**Bounty:** ฿${userData.bounty.toLocaleString()}`,
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
                    
                    console.log(`[LEADERBOARD] ⚠️ Sent error message for poster ${i + 1}/${postersToShow.length}`);
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
    async handleLongLeaderboard(interaction, pirateKing, filteredUsers, buttons, cacheManager, isButtonInteraction) {
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
                    value: `🚨 **TOP 10 MOST WANTED PIRATES** 🚨\n\n\`\`\`diff\n- EXTENDED SURVEILLANCE REPORT:\n- This comprehensive assessment covers the ten most\n- dangerous pirates currently under Marine observation.\n- All personnel are advised to review threat profiles\n- and maintain heightened alert status.\n\`\`\``,
                    inline: false
                });

            await interaction.editReply({ embeds: [headerEmbed] });

            // Get Level 1+ users only
            const level1PlusUsers = filteredUsers.filter(user => user.level >= 1);
            const postersToShow = [];
            
            if (pirateKing) postersToShow.push(pirateKing);
            postersToShow.push(...level1PlusUsers.slice(0, 10));

            console.log(`[LEADERBOARD] Will generate ${postersToShow.length} posters for Top 10`);

            if (postersToShow.length === 0) {
                const noPostersEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('🏴‍☠️ No Wanted Pirates Found')
                    .setDescription('No pirates have reached Level 1+ yet!')
                    .addFields({
                        name: '📋 Requirements',
                        value: 'Pirates must reach at least Level 1 to appear on wanted posters.',
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
                    let intelligenceValue = `\`\`\`diff\n- Alias: ${userData.member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${rank}\n- Threat: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}\n- Activity: ${this.getActivityLevel(userData)}\n\`\`\``;

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
                            text: `⚓ Marine Intelligence Division • Classification: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKingData)}`
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
                            },
                            {
                                name: '❌ Technical Details',
                                value: `**Error Type:** Canvas Generation Failure\n**User ID:** ${userData.userId}\n**Level:** ${userData.level}\n**Bounty:** ฿${userData.bounty.toLocaleString()}`,
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
                    
                    console.log(`[LEADERBOARD] ⚠️ Sent error message for poster ${i + 1}/${postersToShow.length}`);
                }
            }

            console.log('[LEADERBOARD] ✅ Completed Top 10 Bounties generation');

        } catch (error) {
            console.error('[ERROR] Error in handleLongLeaderboard:', error);
            throw error;
        }
    },

    /**
     * Handle All Bounties (text only)
     */
    async handleFullLeaderboard(interaction, pirateKing, filteredUsers, buttons, isButtonInteraction) {
        try {
            console.log('[LEADERBOARD] Starting All Bounties (text) generation...');
            
            const level1Plus = filteredUsers.filter(user => user.level >= 1);
            
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(0xFF0000);

            let intelligenceValue = `🚨 **COMPLETE BOUNTY DATABASE** 🚨\n\n`;

            if (pirateKing) {
                intelligenceValue += `\`\`\`diff\n- EMPEROR: ${pirateKing.member.displayName}\n- Bounty: ฿${pirateKing.bounty.toLocaleString()}\n- Level: ${pirateKing.level} | PIRATE KING\n\`\`\`\n\n`;
            }

            // Add header info
            let headerInfo = `\`\`\`diff\n- COMPLETE SURVEILLANCE DATABASE\n- Active Threats: ${level1Plus.length + (pirateKing ? 1 : 0)}\n- Last Updated: ${new Date().toLocaleString()}\n- Civilian Count: ${filteredUsers.filter(user => user.level === 0).length}\n\`\`\``;
            
            embed.addFields({
                name: '📊 DATABASE STATUS',
                value: headerInfo,
                inline: false
            });

            // Split users into chunks to avoid Discord's character limit
            const chunkSize = 8;
            const chunks = [];
            for (let i = 0; i < level1Plus.length; i += chunkSize) {
                chunks.push(level1Plus.slice(i, i + chunkSize));
            }

            const BountyCalculator = require('../utils/BountyCalculator');
            const bountyCalculator = new BountyCalculator();

            // Add pirates in chunks
            chunks.forEach((chunk, chunkIndex) => {
                let chunkValue = `\`\`\`diff\n`;
                chunk.forEach((user, index) => {
                    const globalIndex = chunkIndex * chunkSize + index + 1;
                    const threatLevel = bountyCalculator.getThreatLevelName(user.level);
                    chunkValue += `- ${String(globalIndex).padStart(2, '0')}. ${user.member.displayName}\n`;
                    chunkValue += `-     ฿${user.bounty.toLocaleString()} | Lv.${user.level}\n`;
                    chunkValue += `-     ${threatLevel.substring(0, 15)}\n\n`;
                });
                chunkValue += `\`\`\``;

                embed.addFields({
                    name: chunkIndex === 0 ? '🏴‍☠️ ACTIVE THREATS' : `🏴‍☠️ CONTINUED (${chunkIndex + 1})`,
                    value: chunkValue,
                    inline: false
                });
            });

            embed.setFooter({ 
                text: `⚓ Marine Intelligence Division • ${level1Plus.length + (pirateKing ? 1 : 0)} Active Profiles`
            })
            .setTimestamp();

            await interaction.editReply({ 
                embeds: [embed], 
                components: [buttons] 
            });

            console.log('[LEADERBOARD] ✅ Completed All Bounties (text) generation');

        } catch (error) {
            console.error('[ERROR] Error in handleFullLeaderboard:', error);
            throw error;
        }
    },

    /**
     * Get activity level description
     */
    getActivityLevel(userData) {
        const totalActivity = userData.messages + userData.reactions + Math.floor(userData.voice_time / 60);
        
        if (totalActivity > 1000) return 'HIGH';
        if (totalActivity > 500) return 'MODERATE';
        if (totalActivity > 100) return 'LOW';
        return 'MINIMAL';
    }
};
