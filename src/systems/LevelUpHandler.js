const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const CanvasGenerator = require('../utils/CanvasGenerator');
const BountyCalculator = require('../utils/BountyCalculator');
const DatabaseManager = require('./DatabaseManager');

/**
 * LevelUpHandler - Handles level up events and notifications using guild settings
 */
class LevelUpHandler {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.dbManager = new DatabaseManager(db);
        this.canvasGenerator = new CanvasGenerator();
        this.bountyCalculator = new BountyCalculator();
    }

    /**
     * Handle level up event with guild settings
     */
    async handleLevelUp(userId, guildId, oldLevel, newLevel, totalXP, user, member, source) {
        try {
            console.log(`[LEVEL UP] ${user.username}: ${oldLevel} → ${newLevel}`);

            // Get guild settings from database
            const guildSettings = await this.dbManager.getGuildSettings(guildId);

            // Award level roles
            const roleReward = await this.awardLevelRoles(member, newLevel);

            // Send level up notification if enabled
            if (guildSettings?.levelup_enabled) {
                await this.sendLevelUpNotification(userId, guildId, oldLevel, newLevel, totalXP, user, member, roleReward, source, guildSettings);
            } else {
                console.log('[LEVEL UP] Level up announcements disabled for this guild');
            }

            // Log level up if enabled
            if (guildSettings?.xp_log_enabled && guildSettings?.xp_log_channel) {
                await this.logLevelUp(user, guildId, oldLevel, newLevel, totalXP, roleReward, source, guildSettings);
            }

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
                if (newLevel >= level && roleId && roleId !== '') {
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
                    if (roleId && roleId !== '' && roleId !== targetRole.role.id && member.roles.cache.has(roleId)) {
                        const oldRole = member.guild.roles.cache.get(roleId);
