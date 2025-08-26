/**
 * DatabaseManager - Handles all database operations and schema management
 * UPDATED VERSION with simplified guild settings and proper daily cap tracking
 */
class DatabaseManager {
    constructor(db) {
        this.db = db;
        
        // Define table names with prefix
        this.tables = {
            userLevels: '"Leveling-Bot_user_levels"',
            dailyXP: '"Leveling-Bot_daily_xp"',
            voiceSessions: '"Leveling-Bot_voice_sessions"',
            guildSettings: '"Leveling-Bot_guild_settings"'
        };
    }

    /**
     * Initialize all required database tables
     */
    async initializeTables() {
        try {
            console.log('🗄️ Initializing Leveling-Bot database tables...');

            // User levels table - main XP tracking
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS ${this.tables.userLevels} (
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    total_xp BIGINT DEFAULT 0,
                    level INTEGER DEFAULT 0,
                    messages INTEGER DEFAULT 0,
                    reactions INTEGER DEFAULT 0,
                    voice_time INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, guild_id)
                )
            `);

            // Daily XP tracking table - ENHANCED with tier tracking
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS ${this.tables.dailyXP} (
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    date DATE NOT NULL,
                    total_xp INTEGER DEFAULT 0,
                    message_xp INTEGER DEFAULT 0,
                    voice_xp INTEGER DEFAULT 0,
                    reaction_xp INTEGER DEFAULT 0,
                    daily_cap INTEGER DEFAULT 15000,
                    tier_level INTEGER DEFAULT 0,
                    tier_role_id VARCHAR(20) DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, guild_id, date)
                )
            `);

            // Voice sessions table - track active sessions
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS ${this.tables.voiceSessions} (
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    channel_id VARCHAR(20) NOT NULL,
                    join_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_xp_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_muted BOOLEAN DEFAULT false,
                    is_deafened BOOLEAN DEFAULT false,
                    PRIMARY KEY (user_id, guild_id)
                )
            `);

            // Guild settings table - SIMPLIFIED with only essential settings
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS ${this.tables.guildSettings} (
                    guild_id VARCHAR(20) PRIMARY KEY,
                    levelup_channel VARCHAR(20) DEFAULT NULL,
                    levelup_enabled BOOLEAN DEFAULT false,
                    xp_log_channel VARCHAR(20) DEFAULT NULL,
                    xp_log_enabled BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for better performance
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_user_levels_total_xp" ON ${this.tables.userLevels}(guild_id, total_xp DESC)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_user_levels_level" ON ${this.tables.userLevels}(guild_id, level DESC)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_daily_xp_date" ON ${this.tables.dailyXP}(date)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_daily_xp_user_date" ON ${this.tables.dailyXP}(user_id, guild_id, date)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_daily_xp_tier" ON ${this.tables.dailyXP}(tier_level, tier_role_id)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_voice_sessions_guild" ON ${this.tables.voiceSessions}(guild_id)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_voice_sessions_channel" ON ${this.tables.voiceSessions}(channel_id)`);
            await this.db.query(`CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_guild_settings_guild" ON ${this.tables.guildSettings}(guild_id)`);

            console.log('✅ Leveling-Bot database tables initialized successfully');

        } catch (error) {
            console.error('❌ Error initializing Leveling-Bot database tables:', error);
            throw error;
        }
    }

    /**
     * Get user XP data
     */
    async getUserXP(userId, guildId) {
        try {
            const result = await this.db.query(
                `SELECT * FROM ${this.tables.userLevels} WHERE user_id = $1 AND guild_id = $2`,
                [userId, guildId]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting user XP:', error);
            return null;
        }
    }

    /**
     * Update user XP and stats
     */
    async updateUserXP(userId, guildId, xpGain, source) {
        try {
            const sourceColumns = {
                message: `messages = ${this.tables.userLevels}.messages + 1`,
                reaction: `reactions = ${this.tables.userLevels}.reactions + 1`,
                voice: `voice_time = ${this.tables.userLevels}.voice_time + 1`
            };

            const sourceColumn = sourceColumns[source] || '';

            const query = `
                INSERT INTO ${this.tables.userLevels} (user_id, guild_id, total_xp, messages, reactions, voice_time)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_id, guild_id)
                DO UPDATE SET
                    total_xp = ${this.tables.userLevels}.total_xp + $3,
                    ${sourceColumn ? sourceColumn + ',' : ''}
                    updated_at = CURRENT_TIMESTAMP
                RETURNING total_xp, level
            `;

            const params = [
                userId, guildId, xpGain,
                source === 'message' ? 1 : 0,
                source === 'reaction' ? 1 : 0,
                source === 'voice' ? 1 : 0
            ];

            const result = await this.db.query(query, params);
            return result.rows[0];

        } catch (error) {
            console.error('Error updating user XP:', error);
            return null;
        }
    }

    /**
     * Update user level
     */
    async updateUserLevel(userId, guildId, newLevel) {
        try {
            await this.db.query(
                `UPDATE ${this.tables.userLevels} SET level = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND guild_id = $3`,
                [newLevel, userId, guildId]
            );
        } catch (error) {
            console.error('Error updating user level:', error);
        }
    }

    /**
     * Get daily XP for user with tier information
     */
    async getDailyXP(userId, guildId, date) {
        try {
            const result = await this.db.query(
                `SELECT * FROM ${this.tables.dailyXP} WHERE user_id = $1 AND guild_id = $2 AND date = $3`,
                [userId, guildId, date]
            );
            
            if (result.rows[0]) {
                return result.rows[0];
            }
            
            return { 
                total_xp: 0, 
                message_xp: 0, 
                voice_xp: 0, 
                reaction_xp: 0,
                daily_cap: parseInt(process.env.DAILY_XP_CAP) || 15000,
                tier_level: 0,
                tier_role_id: null
            };
        } catch (error) {
            console.error('Error getting daily XP:', error);
            return { 
                total_xp: 0, 
                message_xp: 0, 
                voice_xp: 0, 
                reaction_xp: 0,
                daily_cap: parseInt(process.env.DAILY_XP_CAP) || 15000,
                tier_level: 0,
                tier_role_id: null
            };
        }
    }

    /**
     * Update daily XP with tier tracking
     */
    async updateDailyXP(userId, guildId, date, xpGain, source, dailyCap = null, tierLevel = 0, tierRoleId = null) {
        try {
            const sourceColumns = {
                message: `, message_xp = ${this.tables.dailyXP}.message_xp + $4`,
                voice: `, voice_xp = ${this.tables.dailyXP}.voice_xp + $4`,
                reaction: `, reaction_xp = ${this.tables.dailyXP}.reaction_xp + $4`
            };

            const sourceColumn = sourceColumns[source] || '';
            const finalDailyCap = dailyCap || parseInt(process.env.DAILY_XP_CAP) || 15000;

            const query = `
                INSERT INTO ${this.tables.dailyXP} (user_id, guild_id, date, total_xp, message_xp, voice_xp, reaction_xp, daily_cap, tier_level, tier_role_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (user_id, guild_id, date)
                DO UPDATE SET
                    total_xp = ${this.tables.dailyXP}.total_xp + $4,
                    daily_cap = $8,
                    tier_level = $9,
                    tier_role_id = $10
                    ${sourceColumn}
                    , updated_at = CURRENT_TIMESTAMP
                RETURNING total_xp
            `;

            const params = [
                userId, guildId, date, xpGain,
                source === 'message' ? xpGain : 0,
                source === 'voice' ? xpGain : 0,
                source === 'reaction' ? xpGain : 0,
                finalDailyCap,
                tierLevel,
                tierRoleId
            ];

            const result = await this.db.query(query, params);
            return result.rows[0].total_xp;

        } catch (error) {
            console.error('Error updating daily XP:', error);
            return 0;
        }
    }

    /**
     * Get leaderboard data
     */
    async getLeaderboard(guildId, limit = 50, offset = 0) {
        try {
            const result = await this.db.query(`
                SELECT user_id, total_xp, level, messages, reactions, voice_time
                FROM ${this.tables.userLevels} 
                WHERE guild_id = $1 AND total_xp > 0
                ORDER BY total_xp DESC 
                LIMIT $2 OFFSET $3
            `, [guildId, limit, offset]);

            return result.rows;
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            return [];
        }
    }

    /**
     * Get user rank
     */
    async getUserRank(userId, guildId) {
        try {
            const result = await this.db.query(`
                SELECT COUNT(*) + 1 as rank 
                FROM ${this.tables.userLevels} 
                WHERE guild_id = $1 AND total_xp > (
                    SELECT COALESCE(total_xp, 0) FROM ${this.tables.userLevels} 
                    WHERE user_id = $2 AND guild_id = $1
                )
            `, [guildId, userId]);

            return result.rows[0]?.rank || null;
        } catch (error) {
            console.error('Error getting user rank:', error);
            return null;
        }
    }

    /**
     * Voice session management
     */
    async setVoiceSession(userId, guildId, channelId, isMuted = false, isDeafened = false) {
        try {
            console.log(`[DB] Setting voice session for ${userId} in channel ${channelId}`);
            
            const result = await this.db.query(`
                INSERT INTO ${this.tables.voiceSessions} (user_id, guild_id, channel_id, is_muted, is_deafened, join_time, last_xp_time)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, guild_id)
                DO UPDATE SET
                    channel_id = $3,
                    is_muted = $4,
                    is_deafened = $5,
                    join_time = CURRENT_TIMESTAMP,
                    last_xp_time = CURRENT_TIMESTAMP
                RETURNING *
            `, [userId, guildId, channelId, isMuted, isDeafened]);
            
            console.log(`[DB] Voice session set successfully for ${userId}`);
            return result.rows[0];
        } catch (error) {
            console.error('Error setting voice session:', error);
            return null;
        }
    }

    async updateVoiceSession(userId, guildId, isMuted, isDeafened) {
        try {
            console.log(`[DB] Updating voice session for ${userId} - muted: ${isMuted}, deafened: ${isDeafened}`);
            
            const result = await this.db.query(`
                UPDATE ${this.tables.voiceSessions} 
                SET is_muted = $1, is_deafened = $2, last_xp_time = CURRENT_TIMESTAMP
                WHERE user_id = $3 AND guild_id = $4
                RETURNING *
            `, [isMuted, isDeafened, userId, guildId]);
            
            console.log(`[DB] Voice session updated for ${userId}`);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating voice session:', error);
            return null;
        }
    }

    async removeVoiceSession(userId, guildId) {
        try {
            console.log(`[DB] Removing voice session for ${userId}`);
            
            const result = await this.db.query(
                `DELETE FROM ${this.tables.voiceSessions} WHERE user_id = $1 AND guild_id = $2 RETURNING *`,
                [userId, guildId]
            );
            
            console.log(`[DB] Voice session removed for ${userId}`);
            return result.rows[0];
        } catch (error) {
            console.error('Error removing voice session:', error);
            return null;
        }
    }

    async getVoiceSessions(guildId) {
        try {
            const result = await this.db.query(
                `SELECT * FROM ${this.tables.voiceSessions} WHERE guild_id = $1`,
                [guildId]
            );
            
            console.log(`[DB] Retrieved ${result.rows.length} voice sessions for guild ${guildId}`);
            return result.rows;
        } catch (error) {
            console.error('Error getting voice sessions:', error);
            return [];
        }
    }

    async getVoiceSession(userId, guildId) {
        try {
            const result = await this.db.query(
                `SELECT * FROM ${this.tables.voiceSessions} WHERE user_id = $1 AND guild_id = $2`,
                [userId, guildId]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting voice session:', error);
            return null;
        }
    }

    /**
     * Guild settings management - SIMPLIFIED
     */
    async getGuildSettings(guildId) {
        try {
            const result = await this.db.query(
                `SELECT * FROM ${this.tables.guildSettings} WHERE guild_id = $1`,
                [guildId]
            );
            
            // If no settings exist, create default settings
            if (result.rows.length === 0) {
                return await this.createDefaultGuildSettings(guildId);
            }
            
            return result.rows[0];
        } catch (error) {
            console.error('[Leveling-Bot] Error getting guild settings:', error);
            return null;
        }
    }

    async createDefaultGuildSettings(guildId) {
        try {
            const result = await this.db.query(`
                INSERT INTO ${this.tables.guildSettings} (guild_id, levelup_enabled, xp_log_enabled)
                VALUES ($1, false, false)
                RETURNING *
            `, [guildId]);
            
            console.log(`[Leveling-Bot] Created default settings for guild ${guildId}`);
            return result.rows[0];
        } catch (error) {
            console.error('[Leveling-Bot] Error creating default guild settings:', error);
            return null;
        }
    }

    async updateGuildSetting(guildId, settingName, settingValue) {
        try {
            // Ensure guild settings exist first
            await this.getGuildSettings(guildId);
            
            // Build dynamic query based on setting name - ONLY ALLOW VALID SETTINGS
            const validSettings = [
                'levelup_channel', 'levelup_enabled', 
                'xp_log_channel', 'xp_log_enabled'
            ];
            
            if (!validSettings.includes(settingName)) {
                console.error(`[Leveling-Bot] Invalid setting name: ${settingName}`);
                return false;
            }
            
            const query = `
                UPDATE ${this.tables.guildSettings} 
                SET ${settingName} = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE guild_id = $2
                RETURNING *
            `;
            
            const result = await this.db.query(query, [settingValue, guildId]);
            console.log(`[Leveling-Bot] Updated ${settingName} = ${settingValue} for guild ${guildId}`);
            
            return result.rows[0];
        } catch (error) {
            console.error(`[Leveling-Bot] Error updating guild setting ${settingName}:`, error);
            return false;
        }
    }

    async getAllGuildSettings() {
        try {
            const result = await this.db.query(`SELECT * FROM ${this.tables.guildSettings}`);
            return result.rows;
        } catch (error) {
            console.error('[Leveling-Bot] Error getting all guild settings:', error);
            return [];
        }
    }

    /**
     * Get daily XP statistics for guild
     */
    async getDailyXPStats(guildId, date) {
        try {
            const result = await this.db.query(`
                SELECT 
                    COUNT(*) as active_users,
                    SUM(total_xp) as total_guild_xp,
                    AVG(total_xp) as avg_user_xp,
                    MAX(total_xp) as highest_user_xp,
                    SUM(message_xp) as total_message_xp,
                    SUM(voice_xp) as total_voice_xp,
                    SUM(reaction_xp) as total_reaction_xp,
                    AVG(daily_cap) as avg_daily_cap,
                    COUNT(CASE WHEN total_xp >= daily_cap THEN 1 END) as users_at_cap
                FROM ${this.tables.dailyXP} 
                WHERE guild_id = $1 AND date = $2
            `, [guildId, date]);

            return result.rows[0];
        } catch (error) {
            console.error('Error getting daily XP stats:', error);
            return {
                active_users: 0,
                total_guild_xp: 0,
                avg_user_xp: 0,
                highest_user_xp: 0,
                total_message_xp: 0,
                total_voice_xp: 0,
                total_reaction_xp: 0,
                avg_daily_cap: parseInt(process.env.DAILY_XP_CAP) || 15000,
                users_at_cap: 0
            };
        }
    }

    /**
     * Get users currently at daily cap
     */
    async getUsersAtDailyCap(guildId, date) {
        try {
            const result = await this.db.query(`
                SELECT user_id, total_xp, daily_cap, tier_level, tier_role_id
                FROM ${this.tables.dailyXP} 
                WHERE guild_id = $1 AND date = $2 AND total_xp >= daily_cap
                ORDER BY total_xp DESC
            `, [guildId, date]);

            return result.rows;
        } catch (error) {
            console.error('Error getting users at daily cap:', error);
            return [];
        }
    }

    /**
     * Get daily XP progress for specific user
     */
    async getUserDailyProgress(userId, guildId, date) {
        try {
            const result = await this.db.query(`
                SELECT 
                    total_xp,
                    message_xp,
                    voice_xp,
                    reaction_xp,
                    daily_cap,
                    tier_level,
                    tier_role_id,
                    (daily_cap - total_xp) as remaining_xp,
                    ROUND((total_xp::float / daily_cap::float) * 100, 2) as percentage
                FROM ${this.tables.dailyXP} 
                WHERE user_id = $1 AND guild_id = $2 AND date = $3
            `, [userId, guildId, date]);

            if (result.rows[0]) {
                return result.rows[0];
            }

            // Return default if no record exists
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
        } catch (error) {
            console.error('Error getting user daily progress:', error);
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
     * Update user's tier information when roles change
     */
    async updateUserTierInfo(userId, guildId, date, tierLevel, tierRoleId, newDailyCap) {
        try {
            const result = await this.db.query(`
                INSERT INTO ${this.tables.dailyXP} (user_id, guild_id, date, total_xp, daily_cap, tier_level, tier_role_id)
                VALUES ($1, $2, $3, 0, $4, $5, $6)
                ON CONFLICT (user_id, guild_id, date)
                DO UPDATE SET
                    daily_cap = $4,
                    tier_level = $5,
                    tier_role_id = $6,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [userId, guildId, date, newDailyCap, tierLevel, tierRoleId]);

            console.log(`[DB] Updated tier info for ${userId}: Tier ${tierLevel}, Cap: ${newDailyCap}`);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating user tier info:', error);
            return null;
        }
    }

    /**
     * Get all users with tier roles for a specific date
     */
    async getUsersWithTierRoles(guildId, date) {
        try {
            const result = await this.db.query(`
                SELECT user_id, tier_level, tier_role_id, daily_cap, total_xp
                FROM ${this.tables.dailyXP} 
                WHERE guild_id = $1 AND date = $2 AND tier_level > 0
                ORDER BY tier_level DESC, total_xp DESC
            `, [guildId, date]);

            return result.rows;
        } catch (error) {
            console.error('Error getting users with tier roles:', error);
            return [];
        }
    }

    /**
     * Clean up old daily XP records (keep last 30 days) - SAFE FOR SHARED DATABASE
     */
    async cleanupOldDailyXP() {
        try {
            // SAFETY: Only affects Leveling-Bot prefixed table
            const result = await this.db.query(
                `DELETE FROM ${this.tables.dailyXP} WHERE date < CURRENT_DATE - INTERVAL '30 days'`
            );
            
            if (result.rowCount > 0) {
                console.log(`🧹 [Leveling-Bot] Cleaned up ${result.rowCount} old daily XP records (other bots unaffected)`);
            }
        } catch (error) {
            console.error('[Leveling-Bot] Error cleaning up old daily XP:', error);
        }
    }

    /**
     * Clean up orphaned voice sessions - SAFE FOR SHARED DATABASE
     */
    async cleanupOrphanedVoiceSessions(client) {
        try {
            // SAFETY: Only queries Leveling-Bot prefixed table
            const sessions = await this.db.query(`SELECT * FROM ${this.tables.voiceSessions}`);
            let cleanedCount = 0;
            
            for (const session of sessions.rows) {
                try {
                    const guild = client.guilds.cache.get(session.guild_id);
                    if (!guild) {
                        // Guild doesn't exist, remove session (only Leveling-Bot session)
                        await this.removeVoiceSession(session.user_id, session.guild_id);
                        cleanedCount++;
                        continue;
                    }
                    
                    const member = await guild.members.fetch(session.user_id).catch(() => null);
                    if (!member) {
                        // Member not in guild, remove session (only Leveling-Bot session)
                        await this.removeVoiceSession(session.user_id, session.guild_id);
                        cleanedCount++;
                        continue;
                    }
                    
                    // SAFETY CHECK: Remove bots from voice sessions
                    if (member.user.bot) {
                        console.log(`[Leveling-Bot] Removing bot from voice sessions: ${member.user.username}`);
                        await this.removeVoiceSession(session.user_id, session.guild_id);
                        cleanedCount++;
                        continue;
                    }
                    
                    const voiceState = member.voice;
                    if (!voiceState.channelId || voiceState.channelId !== session.channel_id) {
                        // Member not in expected voice channel, remove session (only Leveling-Bot session)
                        await this.removeVoiceSession(session.user_id, session.guild_id);
                        cleanedCount++;
                        continue;
                    }
                } catch (error) {
                    console.error(`[Leveling-Bot] Error checking voice session for ${session.user_id}:`, error);
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`🧹 [Leveling-Bot] Cleaned up ${cleanedCount} orphaned voice sessions (other bots unaffected)`);
            }
        } catch (error) {
            console.error('[Leveling-Bot] Error cleaning up orphaned voice sessions:', error);
        }
    }

    /**
     * Reset all daily XP for new day - SAFE FOR SHARED DATABASE
     */
    async resetDailyXP() {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // SAFETY: Only counts and deletes from Leveling-Bot prefixed table
            const countResult = await this.db.query(`SELECT COUNT(*) FROM ${this.tables.dailyXP} WHERE date < $1`, [today]);
            const recordsToDelete = countResult.rows[0].count;
            
            // Delete old records (only from Leveling-Bot table)
            await this.db.query(`DELETE FROM ${this.tables.dailyXP} WHERE date < $1`, [today]);
            
            console.log(`✅ [Leveling-Bot] Daily XP reset complete - Removed ${recordsToDelete} old records (other bots unaffected)`);
        } catch (error) {
            console.error('[Leveling-Bot] Error resetting daily XP:', error);
        }
    }

    /**
     * Get database statistics - SAFE FOR SHARED DATABASE
     */
    async getDatabaseStats() {
        try {
            const stats = {};
            
            // SAFETY: Only queries Leveling-Bot prefixed tables
            // User levels stats
            const userLevelsResult = await this.db.query(`
                SELECT 
                    COUNT(*) as total_users,
                    SUM(total_xp) as total_xp,
                    AVG(total_xp) as avg_xp,
                    MAX(total_xp) as max_xp,
                    MAX(level) as max_level
                FROM ${this.tables.userLevels} WHERE total_xp > 0
            `);
            stats.userLevels = userLevelsResult.rows[0];
            
            // Daily XP stats (Leveling-Bot only)
            const dailyXPResult = await this.db.query(`
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(DISTINCT user_id) as active_users_today,
                    SUM(total_xp) as total_daily_xp,
                    AVG(total_xp) as avg_daily_xp,
                    COUNT(CASE WHEN total_xp >= daily_cap THEN 1 END) as users_at_cap,
                    AVG(daily_cap) as avg_daily_cap
                FROM ${this.tables.dailyXP} WHERE date = CURRENT_DATE
            `);
            stats.dailyXP = dailyXPResult.rows[0];
            
            // Voice sessions stats (Leveling-Bot only)
            const voiceResult = await this.db.query(`SELECT COUNT(*) as active_sessions FROM ${this.tables.voiceSessions}`);
            stats.voiceSessions = voiceResult.rows[0];
            
            // Guild settings stats
            const guildResult = await this.db.query(`
                SELECT 
                    COUNT(*) as total_guilds,
                    COUNT(CASE WHEN levelup_enabled = true THEN 1 END) as guilds_with_levelup,
                    COUNT(CASE WHEN xp_log_enabled = true THEN 1 END) as guilds_with_logging
                FROM ${this.tables.guildSettings}
            `);
            stats.guildSettings = guildResult.rows[0];
            
            return stats;
        } catch (error) {
            console.error('[Leveling-Bot] Error getting database stats:', error);
            return {};
        }
    }

    /**
     * Cleanup and maintenance - SAFE FOR SHARED DATABASE
     */
    async cleanup() {
        try {
            // SAFETY: Only cleans up Leveling-Bot prefixed tables
            await this.cleanupOldDailyXP();
            console.log('🗄️ [Leveling-Bot] Database cleanup completed (other bots unaffected)');
        } catch (error) {
            console.error('[Leveling-Bot] Error during database cleanup:', error);
        }
    }
}

module.exports = DatabaseManager;
