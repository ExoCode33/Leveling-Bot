/**
 * DatabaseManager - Handles all database operations and schema management
 */
class DatabaseManager {
    constructor(db) {
        this.db = db;
    }

    /**
     * Initialize all required database tables
     */
    async initializeTables() {
        try {
            console.log('🗄️ Initializing database tables...');

            // User levels table - main XP tracking
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS user_levels (
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

            // Daily XP tracking table
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS daily_xp (
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    date DATE NOT NULL,
                    total_xp INTEGER DEFAULT 0,
                    message_xp INTEGER DEFAULT 0,
                    voice_xp INTEGER DEFAULT 0,
                    reaction_xp INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, guild_id, date)
                )
            `);

            // Voice sessions table - track active sessions
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS voice_sessions (
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

            // Guild settings table
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS guild_settings (
                    guild_id VARCHAR(20) PRIMARY KEY,
                    levelup_channel VARCHAR(20),
                    levelup_enabled BOOLEAN DEFAULT true,
                    xp_log_channel VARCHAR(20),
                    xp_log_enabled BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for better performance
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_user_levels_total_xp ON user_levels(guild_id, total_xp DESC)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_daily_xp_date ON daily_xp(date)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_voice_sessions_guild ON voice_sessions(guild_id)');

            console.log('✅ Database tables initialized successfully');

        } catch (error) {
            console.error('❌ Error initializing database tables:', error);
            throw error;
        }
    }

    /**
     * Get user XP data
     */
    async getUserXP(userId, guildId) {
        try {
            const result = await this.db.query(
                'SELECT * FROM user_levels WHERE user_id = $1 AND guild_id = $2',
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
                message: 'messages = user_levels.messages + 1',
                reaction: 'reactions = user_levels.reactions + 1',
                voice: 'voice_time = user_levels.voice_time + 1'
            };

            const sourceColumn = sourceColumns[source] || '';

            const query = `
                INSERT INTO user_levels (user_id, guild_id, total_xp, messages, reactions, voice_time)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_id, guild_id)
                DO UPDATE SET
                    total_xp = user_levels.total_xp + $3,
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
                'UPDATE user_levels SET level = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND guild_id = $3',
                [newLevel, userId, guildId]
            );
        } catch (error) {
            console.error('Error updating user level:', error);
        }
    }

    /**
     * Get daily XP for user
     */
    async getDailyXP(userId, guildId, date) {
        try {
            const result = await this.db.query(
                'SELECT * FROM daily_xp WHERE user_id = $1 AND guild_id = $2 AND date = $3',
                [userId, guildId, date]
            );
            return result.rows[0] || { total_xp: 0, message_xp: 0, voice_xp: 0, reaction_xp: 0 };
        } catch (error) {
            console.error('Error getting daily XP:', error);
            return { total_xp: 0, message_xp: 0, voice_xp: 0, reaction_xp: 0 };
        }
    }

    /**
     * Update daily XP
     */
    async updateDailyXP(userId, guildId, date, xpGain, source) {
        try {
            const sourceColumns = {
                message: ', message_xp = daily_xp.message_xp + $4',
                voice: ', voice_xp = daily_xp.voice_xp + $4',
                reaction: ', reaction_xp = daily_xp.reaction_xp + $4'
            };

            const sourceColumn = sourceColumns[source] || '';

            const query = `
                INSERT INTO daily_xp (user_id, guild_id, date, total_xp, message_xp, voice_xp, reaction_xp)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id, guild_id, date)
                DO UPDATE SET
                    total_xp = daily_xp.total_xp + $4
                    ${sourceColumn}
                    , updated_at = CURRENT_TIMESTAMP
                RETURNING total_xp
            `;

            const params = [
                userId, guildId, date, xpGain,
                source === 'message' ? xpGain : 0,
                source === 'voice' ? xpGain : 0,
                source === 'reaction' ? xpGain : 0
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
                FROM user_levels 
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
                FROM user_levels 
                WHERE guild_id = $1 AND total_xp > (
                    SELECT COALESCE(total_xp, 0) FROM user_levels 
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
            await this.db.query(`
                INSERT INTO voice_sessions (user_id, guild_id, channel_id, is_muted, is_deafened)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id, guild_id)
                DO UPDATE SET
                    channel_id = $3,
                    join_time = CURRENT_TIMESTAMP,
                    is_muted = $4,
                    is_deafened = $5
            `, [userId, guildId, channelId, isMuted, isDeafened]);
        } catch (error) {
            console.error('Error setting voice session:', error);
        }
    }

    async updateVoiceSession(userId, guildId, isMuted, isDeafened) {
        try {
            await this.db.query(`
                UPDATE voice_sessions 
                SET is_muted = $1, is_deafened = $2, last_xp_time = CURRENT_TIMESTAMP
                WHERE user_id = $3 AND guild_id = $4
            `, [isMuted, isDeafened, userId, guildId]);
        } catch (error) {
            console.error('Error updating voice session:', error);
        }
    }

    async removeVoiceSession(userId, guildId) {
        try {
            await this.db.query(
                'DELETE FROM voice_sessions WHERE user_id = $1 AND guild_id = $2',
                [userId, guildId]
            );
        } catch (error) {
            console.error('Error removing voice session:', error);
        }
    }

    async getVoiceSessions(guildId) {
        try {
            const result = await this.db.query(
                'SELECT * FROM voice_sessions WHERE guild_id = $1',
                [guildId]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting voice sessions:', error);
            return [];
        }
    }

    /**
     * Clean up old daily XP records (keep last 30 days)
     */
    async cleanupOldDailyXP() {
        try {
            const result = await this.db.query(
                "DELETE FROM daily_xp WHERE date < CURRENT_DATE - INTERVAL '30 days'"
            );
            
            if (result.rowCount > 0) {
                console.log(`🧹 Cleaned up ${result.rowCount} old daily XP records`);
            }
        } catch (error) {
            console.error('Error cleaning up old daily XP:', error);
        }
    }

    /**
     * Reset all daily XP for new day
     */
    async resetDailyXP() {
        try {
            const today = new Date().toISOString().split('T')[0];
            await this.db.query('DELETE FROM daily_xp WHERE date < $1', [today]);
            console.log('✅ Daily XP reset complete');
        } catch (error) {
            console.error('Error resetting daily XP:', error);
        }
    }

    /**
     * Cleanup and close connections
     */
    async cleanup() {
        try {
            await this.cleanupOldDailyXP();
            await this.db.end();
            console.log('🗄️ Database connections closed');
        } catch (error) {
            console.error('Error during database cleanup:', error);
        }
    }
}

module.exports = DatabaseManager;
