const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const CanvasGenerator = require('../utils/CanvasGenerator');
const BountyCalculator = require('../utils/BountyCalculator');
const LevelCalculator = require('../utils/LevelCalculator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('View level information and stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check level for')
                .setRequired(false)),

    async execute(interaction, { xpManager, databaseManager }) {
        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const member = interaction.guild.members.cache.get(targetUser.id);
            
            if (!member) {
                return await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('MARINE INTELLIGENCE BUREAU')
                        .setDescription('```diff\n- TARGET NOT FOUND IN DATABASE\n- INSUFFICIENT INTELLIGENCE DATA\n```')
                        .setFooter({ text: 'World Government Intelligence Division' })
                        .setTimestamp()],
                    ephemeral: true
                });
            }

            // Defer reply for canvas processing
            await interaction.deferReply();

            // Check if user has excluded role (Pirate King)
            const excludedRoleId = process.env.LEADERBOARD_EXCLUDE_ROLE;
            const isPirateKing = excludedRoleId && member.roles.cache.has(excludedRoleId);

            // Get user stats
            const userStats = await xpManager.getUserStats(targetUser.id, interaction.guild.id);
            
            if (!userStats && !isPirateKing) {
                return await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('MARINE INTELLIGENCE BUREAU')
                        .setDescription('```diff\n- NO CRIMINAL RECORD FOUND\n- TARGET NOT IN DATABASE\n```')
                        .setFooter({ text: 'World Government Intelligence Division' })
                        .setTimestamp()]
                });
            }

            let userData;
            const bountyCalculator = new BountyCalculator();
            const levelCalculator = new LevelCalculator();

            if (isPirateKing) {
                // Pirate King data
                console.log(`[LEVEL] Displaying Pirate King data for ${targetUser.username}`);
                
                userData = {
                    userId: targetUser.id,
                    level: currentLevel,
                    total_xp: userStats.total_xp,
                    messages: userStats.messages || 0,
                    reactions: userStats.reactions || 0,
                    voice_time: userStats.voice_time || 0,
                    member: member,
                    isPirateKing: false,
                    rank: userStats.rank || 'Unknown',
                    bounty: bounty
                };
            }

            // Create wanted poster canvas
            const canvasGenerator = new CanvasGenerator();
            const canvas = await canvasGenerator.createWantedPoster(userData, interaction.guild);
            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: `wanted_${targetUser.id}.png` });

            // Create Marine Intelligence report
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: '🌐 WORLD GOVERNMENT INTELLIGENCE BUREAU'
                })
                .setColor(isPirateKing ? 0xFFD700 : 0xFF0000);

            // Intelligence summary
            let intelligenceValue = `\`\`\`diff\n- Alias: ${member.displayName}\n- Bounty: ฿${userData.bounty.toLocaleString()}\n- Level: ${userData.level} | Rank: ${userData.rank}\n- Threat: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKing)}\n- Total XP: ${userData.total_xp.toLocaleString()}\n\`\`\``;

            embed.addFields({
                name: '📊 INTELLIGENCE SUMMARY',
                value: intelligenceValue,
                inline: false
            });

            // Add progress to next level (only for regular users)
            if (!isPirateKing && userData.level < 50) {
                const progress = levelCalculator.getLevelProgress(userData.total_xp);
                
                embed.addFields({
                    name: '📈 ADVANCEMENT ANALYSIS',
                    value: `\`\`\`diff\n- Progress to Next Level: ${progress.percentage}%\n- XP Required: ${progress.xpToNext.toLocaleString()}\n- Current Level XP: ${progress.progressXP.toLocaleString()}/${progress.totalLevelXP.toLocaleString()}\n\`\`\``,
                    inline: false
                });
            }

            // Activity breakdown
            const totalActivity = userData.messages + userData.reactions + Math.floor(userData.voice_time / 60);
            embed.addFields({
                name: '📋 ACTIVITY BREAKDOWN',
                value: `\`\`\`diff\n- Messages: ${userData.messages.toLocaleString()}\n- Reactions: ${userData.reactions.toLocaleString()}\n- Voice Time: ${userData.voice_time.toLocaleString()} minutes\n- Total Activity: ${totalActivity.toLocaleString()}\n\`\`\``,
                inline: false
            });

            if (isPirateKing) {
                embed.addFields({
                    name: '👑 SPECIAL CLASSIFICATION',
                    value: `\`\`\`diff\n- EMPEROR STATUS CONFIRMED\n- MAXIMUM THREAT DESIGNATION\n- APPROACH WITH EXTREME CAUTION\n\`\`\``,
                    inline: false
                });
            }

            embed.setImage(`attachment://wanted_${targetUser.id}.png`)
                .setFooter({ 
                    text: `⚓ Marine Intelligence Division • Classification: ${bountyCalculator.getThreatLevelName(userData.level, isPirateKing)}`
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error('[ERROR] Error in level command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('MARINE INTELLIGENCE BUREAU')
                .setDescription('```diff\n- INTELLIGENCE SYSTEM ERROR\n- DATA RETRIEVAL FAILED\n- CONTACT MARINE HEADQUARTERS\n```')
                .setFooter({ text: 'World Government Intelligence Division' })
                .setTimestamp();

            if (interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};d: targetUser.id,
                    level: 55, // Special level for Pirate King
                    total_xp: 999999999,
                    messages: 0,
                    reactions: 0,
                    voice_time: 0,
                    member: member,
                    isPirateKing: true,
                    rank: 'PIRATE KING',
                    bounty: bountyCalculator.getBountyForLevel(55, true)
                };
            } else {
                // Regular user data
                const currentLevel = levelCalculator.calculateLevel(userStats.total_xp);
                const bounty = bountyCalculator.getBountyForLevel(currentLevel);
                
                userData = {
                    userI
