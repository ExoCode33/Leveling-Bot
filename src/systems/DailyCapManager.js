const DatabaseManager = require('./DatabaseManager');

/**
 * DailyCapManager - Manages daily XP caps including tier bonuses with proper tracking
 */
class DailyCapManager {
    constructor(db) {
        this.db = db;
        this.dbManager = new DatabaseManager(db);
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
     * Get user's daily XP cap (includes tier bonuses) - UPDATED WITH TIER TRACKING
     */
    async getUserDailyCap(userId, guildId, member = null) {
        try {
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            const currentDay = this.getCurrentDay();
            
            if (!member) {
                return { cap: baseCap, tier: 0, roleId: null };
            }

            // Check for tier roles (highest tier wins)
            let highestTier = 0;
            let highestTierCap = baseCap;
            let tierRoleId = null;

            for (let tier = 10; tier >= 1; tier--) {
                const roleId = process.env[`TIER_${tier}_ROLE`];
                const tierCap = parseInt(process.env[`TIER_${tier}_XP_CAP`]) || 0;
                
                if (roleId && tierCap > 0 && member.roles.cache.has(roleId)) {
                    console.log(`[DAILY CAP] ${member.displayName} has Tier ${tier} role: ${tierCap.toLocaleString()} XP cap`);
                    highestTier = tier;
                    highestTierCap = tierCap;
                    tierRoleId = roleId;
                    break; // Take the highest tier
                }
            }

            // Update the user's tier information in the database
            await this.dbManager.updateUserTierInfo(userId, guildId, currentDay, highestTier, tierRoleId, highestTierCap);

            console.log(`[DAILY CAP] ${member.displayName} final cap: ${highestTierCap.toLocaleString()} XP (Tier ${highestTier})`);
            return { cap: highestTierCap, tier: highestTier, roleId: tierRoleId };
            
        } catch (error) {
            console.error('Error getting user daily cap:', error);
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            return { cap: baseCap, tier: 0, roleId: null };
        }
    }

    /**
     * Get user's current daily XP with detailed information
     */
    async getUserDailyXP(userId, guildId) {
        try {
            const currentDay = this.getCurrentDay();
            const progress = await this.dbManager.getUserDailyProgress(userId, guildId, currentDay);
            return progress;
        } catch (error) {
            console.error('Error getting user daily XP:', error);
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            return {
                total_xp: 0,
                message_xp: 0,
                voice_xp: 0,
                reaction_xp: 0,
                daily_cap: baseCap,
                tier_level: 0,
                tier_role_id: null,
                remaining_xp: baseCap,
                percentage: 0
            };
        }
    }

    /**
     * Check if user can gain XP (not at cap) - ENHANCED WITH TIER TRACKING
     */
    async canGainXP(userId, guildId, member = null) {
        try {
            const dailyProgress = await this.getUserDailyXP(userId, guildId);
            
            // Get current tier information
            const tierInfo = await this.getUserDailyCap(userId, guildId, member);
            
            // Check if the user's tier has changed and update cap if needed
            if (member && (tierInfo.tier !== dailyProgress.tier_level || tierInfo.roleId !== dailyProgress.tier_role_id)) {
                console.log(`[DAILY CAP] Tier change detected for ${member.displayName}: ${dailyProgress.tier_level} → ${tierInfo.tier}`);
                
                const currentDay = this.getCurrentDay();
                await this.dbManager.updateUserTierInfo(userId, guildId, currentDay, tierInfo.tier, tierInfo.roleId, tierInfo.cap);
                
                // Update the daily progress with new cap
                dailyProgress.daily_cap = tierInfo.cap;
                dailyProgress.tier_level = tierInfo.tier;
                dailyProgress.tier_role_id = tierInfo.roleId;
                dailyProgress.remaining_xp = Math.max(0, tierInfo.cap - dailyProgress.total_xp);
                dailyProgress.percentage = Math.round((dailyProgress.total_xp / tierInfo.cap) * 100);
            }
            
            const allowed = dailyProgress.total_xp < dailyProgress.daily_cap;
            const remaining = Math.max(0, dailyProgress.daily_cap - dailyProgress.total_xp);
            
            return {
                allowed,
                currentXP: dailyProgress.total_xp,
                dailyCap: dailyProgress.daily_cap,
                remaining,
                percentage: dailyProgress.percentage,
                tierLevel: dailyProgress.tier_level,
                tierRoleId: dailyProgress.tier_role_id,
                breakdown: {
                    messageXP: dailyProgress.message_xp,
                    voiceXP: dailyProgress.voice_xp,
                    reactionXP: dailyProgress.reaction_xp
                }
            };
        } catch (error) {
            console.error('Error checking if user can gain XP:', error);
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            return { 
                allowed: true, 
                currentXP: 0, 
                dailyCap: baseCap, 
                remaining: baseCap, 
                percentage: 0,
                tierLevel: 0,
                tierRoleId: null,
                breakdown: { messageXP: 0, voiceXP: 0, reactionXP: 0 }
            };
        }
    }

    /**
     * Add XP to user's daily total - ENHANCED WITH TIER TRACKING
     */
    async addXP(userId, guildId, xpAmount, source, member = null) {
        try {
            const currentDay = this.getCurrentDay();
            const tierInfo = await this.getUserDailyCap(userId, guildId, member);
            
            const newTotal = await this.dbManager.updateDailyXP(
                userId, 
                guildId, 
                currentDay, 
                xpAmount, 
                source, 
                tierInfo.cap, 
                tierInfo.tier, 
                tierInfo.roleId
            );
            
            return newTotal;
        } catch (error) {
            console.error('Error adding XP to daily total:', error);
            return 0;
        }
    }

    /**
     * Get daily XP stats for user - ENHANCED
     */
    async getDailyStats(userId, guildId, member = null) {
        try {
            const currentDay = this.getCurrentDay();
            const progress = await this.dbManager.getUserDailyProgress(userId, guildId, currentDay);
            const tierInfo = await this.getUserDailyCap(userId, guildId, member);
            
            // Ensure we have the most current tier information
            const finalCap = Math.max(progress.daily_cap, tierInfo.cap);
            const finalTier = Math.max(progress.tier_level, tierInfo.tier);
            
            return {
                date: currentDay,
                totalXP: progress.total_xp || 0,
                messageXP: progress.message_xp || 0,
                voiceXP: progress.voice_xp || 0,
                reactionXP: progress.reaction_xp || 0,
                dailyCap: finalCap,
                remaining: Math.max(0, finalCap - (progress.total_xp || 0)),
                percentage: Math.round(((progress.total_xp || 0) / finalCap) * 100),
                isAtCap: (progress.total_xp || 0) >= finalCap,
                tierLevel: finalTier,
                tierRoleId: progress.tier_role_id || tierInfo.roleId,
                tierName: this.getTierName(finalTier)
            };
        } catch (error) {
            console.error('Error getting daily stats:', error);
            const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
            return {
                date: this.getCurrentDay(),
                totalXP: 0,
                messageXP: 0,
                voiceXP: 0,
                reactionXP: 0,
                dailyCap: baseCap,
                remaining: baseCap,
                percentage: 0,
                isAtCap: false,
                tierLevel: 0,
                tierRoleId: null,
                tierName: 'Standard'
            };
        }
    }

    /**
     * Get tier name for display
     */
    getTierName(tierLevel) {
        if (tierLevel === 0) return 'Standard';
        return `Tier ${tierLevel}`;
    }

    /**
     * Handle role changes that affect daily caps
     */
    async handleRoleChange(member, oldRoles, newRoles) {
        try {
            console.log(`[DAILY CAP] Handling role change for ${member.displayName}`);
            
            // Check if any tier roles were affected
            const tierRoles = [];
            for (let tier = 1; tier <= 10; tier++) {
                const roleId = process.env[`TIER_${tier}_ROLE`];
                if (roleId) {
                    tierRoles.push({ tier, roleId });
                }
            }
            
            let tierRoleChanged = false;
            for (const { tier, roleId } of tierRoles) {
                const hadRole = oldRoles.has(roleId);
                const hasRole = newRoles.has(roleId);
                
                if (hadRole !== hasRole) {
                    tierRoleChanged = true;
                    if (hasRole) {
                        console.log(`[DAILY CAP] ${member.displayName} gained Tier ${tier} role`);
                    } else {
                        console.log(`[DAILY CAP] ${member.displayName} lost Tier ${tier} role`);
                    }
                }
            }
            
            if (tierRoleChanged) {
                console.log(`[DAILY CAP] Updating daily cap for ${member.displayName} due to tier role change`);
                
                // Update the user's daily cap information
                const currentDay = this.getCurrentDay();
                const tierInfo = await this.getUserDailyCap(member.id, member.guild.id, member);
                
                await this.dbManager.updateUserTierInfo(
                    member.id, 
                    member.guild.id, 
                    currentDay, 
                    tierInfo.tier, 
                    tierInfo.roleId, 
                    tierInfo.cap
                );
                
                console.log(`[DAILY CAP] ${member.displayName} new daily cap: ${tierInfo.cap.toLocaleString()} XP (Tier ${tierInfo.tier})`);
            }
        } catch (error) {
            console.error('Error handling role change:', error);
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
            
            await this.dbManager.resetDailyXP();
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
            await this.dbManager.cleanupOldDailyXP();
        } catch (error) {
            console.error('Error cleaning up old records:', error);
        }
    }

    /**
     * Get guild daily stats - ENHANCED WITH TIER INFORMATION
     */
    async getGuildDailyStats(guildId) {
        try {
            const currentDay = this.getCurrentDay();
            const stats = await this.dbManager.getDailyXPStats(guildId, currentDay);
            const usersAtCap = await this.dbManager.getUsersAtDailyCap(guildId, currentDay);
            const tierUsers = await this.dbManager.getUsersWithTierRoles(guildId, currentDay);
            
            return {
                date: currentDay,
                activeUsers: parseInt(stats.active_users) || 0,
                totalGuildXP: parseInt(stats.total_guild_xp) || 0,
                averageUserXP: Math.round(parseFloat(stats.avg_user_xp)) || 0,
                highestUserXP: parseInt(stats.highest_user_xp) || 0,
                totalMessageXP: parseInt(stats.total_message_xp) || 0,
                totalVoiceXP: parseInt(stats.total_voice_xp) || 0,
                totalReactionXP: parseInt(stats.total_reaction_xp) || 0,
                averageDailyCap: Math.round(parseFloat(stats.avg_daily_cap)) || 15000,
                usersAtCap: parseInt(stats.users_at_cap) || 0,
                usersAtCapList: usersAtCap,
                tierUsers: tierUsers,
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
                averageDailyCap: parseInt(process.env.DAILY_XP_CAP) || 15000,
                usersAtCap: 0,
                usersAtCapList: [],
                tierUsers: [],
                nextReset: this.getNextResetTimestamp()
            };
        }
    }

    /**
     * Get leaderboard of daily XP progress
     */
    async getDailyLeaderboard(guildId, limit = 10) {
        try {
            const currentDay = this.getCurrentDay();
            const result = await this.db.query(`
                SELECT 
                    user_id, 
                    total_xp, 
                    daily_cap, 
                    tier_level, 
                    tier_role_id,
                    message_xp,
                    voice_xp,
                    reaction_xp,
                    ROUND((total_xp::float / daily_cap::float) * 100, 2) as percentage
                FROM ${this.dbManager.tables.dailyXP} 
                WHERE guild_id = $1 AND date = $2 AND total_xp > 0
                ORDER BY total_xp DESC 
                LIMIT $3
            `, [guildId, currentDay, limit]);

            return result.rows.map(row => ({
                userId: row.user_id,
                totalXP: parseInt(row.total_xp),
                dailyCap: parseInt(row.daily_cap),
                tierLevel: parseInt(row.tier_level),
                tierRoleId: row.tier_role_id,
                messageXP: parseInt(row.message_xp),
                voiceXP: parseInt(row.voice_xp),
                reactionXP: parseInt(row.reaction_xp),
                percentage: parseFloat(row.percentage),
                remaining: Math.max(0, parseInt(row.daily_cap) - parseInt(row.total_xp)),
                isAtCap: parseInt(row.total_xp) >= parseInt(row.daily_cap)
            }));
        } catch (error) {
            console.error('Error getting daily leaderboard:', error);
            return [];
        }
    }

    /**
     * Check if user has hit daily cap and log if needed
     */
    async checkAndLogDailyCap(userId, guildId, member, xpLogger) {
        try {
            const progress = await this.canGainXP(userId, guildId, member);
            
            if (!progress.allowed && progress.currentXP >= progress.dailyCap) {
                console.log(`[DAILY CAP] ${member?.displayName || userId} has reached daily cap: ${progress.dailyCap.toLocaleString()} XP`);
                
                // Log to XP logger if available
                if (xpLogger && member) {
                    const tierName = this.getTierName(progress.tierLevel);
                    await xpLogger.logDailyCapReached(member.user, guildId, progress.dailyCap, tierName);
                }
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error checking daily cap:', error);
            return false;
        }
    }

    /**
     * Get tier role information for debugging
     */
    getTierRoleInfo() {
        const tiers = [];
        
        for (let tier = 1; tier <= 10; tier++) {
            const roleId = process.env[`TIER_${tier}_ROLE`];
            const capAmount = process.env[`TIER_${tier}_XP_CAP`];
            
            if (roleId && capAmount && roleId !== '' && capAmount !== '') {
                tiers.push({
                    tier,
                    roleId,
                    cap: parseInt(capAmount),
                    isConfigured: true
                });
            } else {
                tiers.push({
                    tier,
                    roleId: null,
                    cap: 0,
                    isConfigured: false
                });
            }
        }
        
        return tiers;
    }

    /**
     * Validate tier configuration
     */
    validateTierConfiguration() {
        const issues = [];
        const baseCap = parseInt(process.env.DAILY_XP_CAP) || 15000;
        
        for (let tier = 1; tier <= 10; tier++) {
            const roleId = process.env[`TIER_${tier}_ROLE`];
            const capAmount = parseInt(process.env[`TIER_${tier}_XP_CAP`]) || 0;
            
            if (roleId && !capAmount) {
                issues.push(`Tier ${tier}: Role ID provided but no XP cap specified`);
            } else if (!roleId && capAmount) {
                issues.push(`Tier ${tier}: XP cap provided but no role ID specified`);
            } else if (roleId && capAmount && capAmount <= baseCap) {
                issues.push(`Tier ${tier}: XP cap (${capAmount}) should be higher than base cap (${baseCap})`);
            }
        }
        
        return {
            valid: issues.length === 0,
            issues,
            baseCap,
            configuredTiers: this.getTierRoleInfo().filter(t => t.isConfigured).length
        };
    }

    /**
     * Get comprehensive daily statistics for admin command
     */
    async getComprehensiveDailyStats(guildId) {
        try {
            const guildStats = await this.getGuildDailyStats(guildId);
            const leaderboard = await this.getDailyLeaderboard(guildId, 5);
            const validation = this.validateTierConfiguration();
            
            return {
                ...guildStats,
                topDailyUsers: leaderboard,
                tierConfiguration: validation,
                resetInfo: {
                    nextResetTimestamp: this.getNextResetTimestamp(),
                    resetTime: `${process.env.DAILY_RESET_HOUR_EDT || 19}:${String(process.env.DAILY_RESET_MINUTE_EDT || 35).padStart(2, '0')} EDT`,
                    currentDay: this.getCurrentDay()
                }
            };
        } catch (error) {
            console.error('Error getting comprehensive daily stats:', error);
            return null;
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
