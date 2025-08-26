/**
 * DailyCapManager - Manages daily XP caps including tier bonuses
 */
class DailyCapManager {
    constructor(db) {
        this.db = db;
    }

    /**
     * Initialize daily cap manager
     */
    async initialize() {
        try {
            console.log('🔄 Initializing Daily Cap Manager...');
            
            // Clean up old records on startup
            await this.cleanupOldRecords();
            
            console.log('✅ Daily Cap Manager initialized');
        } catch (error) {
            console.error('❌ Error initializing Daily Cap Manager:', error);
            throw error;
        }
    }

    /**
     * Get current day string (EDT timezone)
     */
    getCurrentDay() {
        const now = new Date();
        const edtOffset = this.isEDT(now) ? -4 : -5;
        const edtTime = new Date(now.getTime() + (edtOffset * 60 * 60 * 1000));
        
        // Daily reset is at configured hour, so if before that time, use previous day
        const resetHour = parseInt(process.env.DAILY_RESET_HOUR_EDT) || 19;
        const resetMinute = parseInt(process.env.DAILY_RESET_MINUTE_EDT) || 35;
        
        if (edtTime.getHours() < resetHour || 
            (edtTime.getHours() === resetHour && edtTime.getMinutes() < resetMinute)) {
            edtTime.setDate(edtTime.getDate() - 1);
        }
        
        return edtTime.toISOString().split('T')[0];
    }

    /**
     * Check if date is EDT
     */
    isEDT(date) {
        const year = date.getFullYear();
        const marchSecondSunday = new Date(year, 2, 8);
        marchSecondSunday.setDate(marchSecondSunday.getDate() + (7 - marchSecondSunday.getDay()));
        const novemberFirstSunday = new Date(year, 10, 1);
        novemberFirstSunday.setDate(novemberFirstSunday.getDate() + (7 - novemberFirstSunday.getDay()));
        return date >= marchSecondSunday && date < novemberFirstSunday;
    }

    /**
     * Get user's daily XP cap (includes tier bonuses)
     */
    async getUserDailyCap(userId, guildId, member = null) {
        try {
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            
            if (!member) {
                return baseCap;
            }

            // Check for tier roles (highest tier wins)
            for (let tier = 10; tier >= 1; tier--) {
                const roleId = process.env[`TIER_${tier}_ROLE`];
                const tierCap = parseInt(process.env[`TIER_${tier}_XP_CAP`]) || 0;
                
                if (roleId && tierCap > 0 && member.roles.cache.has(roleId)) {
                    console.log(`[DAILY CAP] ${member.displayName} has Tier ${tier} cap: ${tierCap.toLocaleString()} XP`);
                    return tierCap;
                }
            }

            console.log(`[DAILY CAP] ${member.displayName} using base cap: ${baseCap.toLocaleString()} XP`);
            return baseCap;
            
        } catch (error) {
            console.error('Error getting user daily cap:', error);
            return parseInt(process.env.DAILY_XP_CAP) || 15000;
        }
    }

    /**
     * Get user's current daily XP
     */
    async getUserDailyXP(userId, guildId) {
        try {
            const currentDay = this.getCurrentDay();
            const { DatabaseManager } = require('./DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            const dailyData = await dbManager.getDailyXP(userId, guildId, currentDay);
            return dailyData.total_xp || 0;
        } catch (error) {
            console.error('Error getting user daily XP:', error);
            return 0;
        }
    }

    /**
     * Check if user can gain XP (not at cap)
     */
    async canGainXP(userId, guildId, member = null) {
        try {
            const currentXP = await this.getUserDailyXP(userId, guildId);
            const dailyCap = await this.getUserDailyCap(userId, guildId, member);
            
            const allowed = currentXP < dailyCap;
            const remaining = Math.max(0, dailyCap - currentXP);
            
            return {
                allowed,
                currentXP,
                dailyCap,
                remaining,
                percentage: Math.round((currentXP / dailyCap) * 100)
            };
        } catch (error) {
            console.error('Error checking if user can gain XP:', error);
            return { allowed: true, currentXP: 0, dailyCap: 15000, remaining: 15000, percentage: 0 };
        }
    }

    /**
     * Add XP to user's daily total
     */
    async addXP(userId, guildId, xpAmount, source) {
        try {
            const currentDay = this.getCurrentDay();
            const { DatabaseManager } = require('./DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            const newTotal = await dbManager.updateDailyXP(userId, guildId, currentDay, xpAmount, source);
            return newTotal;
        } catch (error) {
            console.error('Error adding XP to daily total:', error);
            return 0;
        }
    }

    /**
     * Get daily XP stats for user
     */
    async getDailyStats(userId, guildId, member = null) {
        try {
            const currentDay = this.getCurrentDay();
            const { DatabaseManager } = require('./DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            const dailyData = await dbManager.getDailyXP(userId, guildId, currentDay);
            const dailyCap = await this.getUserDailyCap(userId, guildId, member);
            
            return {
                date: currentDay,
                totalXP: dailyData.total_xp || 0,
                messageXP: dailyData.message_xp || 0,
                voiceXP: dailyData.voice_xp || 0,
                reactionXP: dailyData.reaction_xp || 0,
                dailyCap: dailyCap,
                remaining: Math.max(0, dailyCap - (dailyData.total_xp || 0)),
                percentage: Math.round(((dailyData.total_xp || 0) / dailyCap) * 100),
                isAtCap: (dailyData.total_xp || 0) >= dailyCap
            };
        } catch (error) {
            console.error('Error getting daily stats:', error);
            return {
                date: this.getCurrentDay(),
                totalXP: 0,
                messageXP: 0,
                voiceXP: 0,
                reactionXP: 0,
                dailyCap: parseInt(process.env.DAILY_XP_CAP) || 15000,
                remaining: parseInt(process.env.DAILY_XP_CAP) || 15000,
                percentage: 0,
                isAtCap: false
            };
        }
    }

    /**
     * Get next reset timestamp (Unix)
     */
    getNextResetTimestamp() {
        const now = new Date();
        const resetHour = parseInt(process.env.DAILY_RESET_HOUR_EDT) || 19;
        const resetMinute = parseInt(process.env.DAILY_RESET_MINUTE_EDT) || 35;
        
        // Calculate next reset time in EDT
        const edtOffset = this.isEDT(now) ? -4 : -5;
        const edtNow = new Date(now.getTime() + (edtOffset * 60 * 60 * 1000));
        
        let nextReset = new Date(edtNow);
        nextReset.setHours(resetHour, resetMinute, 0, 0);
        
        // If reset time has passed today, schedule for tomorrow
        if (edtNow.getTime() >= nextReset.getTime()) {
            nextReset.setDate(nextReset.getDate() + 1);
        }
        
        // Convert back to UTC
        const utcReset = new Date(nextReset.getTime() - (edtOffset * 60 * 60 * 1000));
        return Math.floor(utcReset.getTime() / 1000);
    }

    /**
     * Reset daily XP for all users
     */
    async resetDaily() {
        try {
            console.log('🔄 Performing daily XP reset...');
            
            const { DatabaseManager } = require('./DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            await dbManager.resetDailyXP();
            await this.cleanupOldRecords();
            
            console.log('✅ Daily XP reset complete');
        } catch (error) {
            console.error('❌ Error during daily reset:', error);
        }
    }

    /**
     * Clean up old daily XP records (keep last 30 days)
     */
    async cleanupOldRecords() {
        try {
            const { DatabaseManager } = require('./DatabaseManager');
            const dbManager = new DatabaseManager(this.db);
            
            await dbManager.cleanupOldDailyXP();
        } catch (error) {
            console.error('Error cleaning up old records:', error);
        }
    }

    /**
     * Get guild daily stats
     */
    async getGuildDailyStats(guildId) {
        try {
            const currentDay = this.getCurrentDay();
            
            const result = await this.db.query(`
                SELECT 
                    COUNT(*) as active_users,
                    SUM(total_xp) as total_guild_xp,
                    AVG(total_xp) as avg_user_xp,
                    MAX(total_xp) as highest_user_xp,
                    SUM(message_xp) as total_message_xp,
                    SUM(voice_xp) as total_voice_xp,
                    SUM(reaction_xp) as total_reaction_xp
                FROM daily_xp 
                WHERE guild_id = $1 AND date = $2
            `, [guildId, currentDay]);

            const stats = result.rows[0];
            
            return {
                date: currentDay,
                activeUsers: parseInt(stats.active_users) || 0,
                totalGuildXP: parseInt(stats.total_guild_xp) || 0,
                averageUserXP: Math.round(parseFloat(stats.avg_user_xp)) || 0,
                highestUserXP: parseInt(stats.highest_user_xp) || 0,
                totalMessageXP: parseInt(stats.total_message_xp) || 0,
                totalVoiceXP: parseInt(stats.total_voice_xp) || 0,
                totalReactionXP: parseInt(stats.total_reaction_xp) || 0,
                nextReset: this.getNextResetTimestamp()
            };
        } catch (error) {
            console.error('Error getting guild daily stats:', error);
            return {
                date: this.getCurrentDay(),
                activeUsers: 0,
                totalGuildXP: 0,
                averageUserXP: 0,
                highestUserXP: 0,
                totalMessageXP: 0,
                totalVoiceXP: 0,
                totalReactionXP: 0,
                nextReset: this.getNextResetTimestamp()
            };
        }
    }

    /**
     * Cleanup
     */
    async cleanup() {
        try {
            await this.cleanupOldRecords();
            console.log('🧹 Daily Cap Manager cleanup complete');
        } catch (error) {
            console.error('Error during Daily Cap Manager cleanup:', error);
        }
    }
}

module.exports = DailyCapManager;
