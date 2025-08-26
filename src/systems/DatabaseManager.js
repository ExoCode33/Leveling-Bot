-- COMPLETE DATABASE SETUP FOR ONE PIECE XP BOT
-- ALL TABLES USE "Leveling-Bot" PREFIX INCLUDING GUILD SETTINGS
-- SAFE FOR SHARED DATABASE - ONLY AFFECTS LEVELING-BOT TABLES

-- 1. MAIN USER LEVELS TABLE (REQUIRED)
CREATE TABLE IF NOT EXISTS "Leveling-Bot_user_levels" (
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
);

-- 2. DAILY XP TRACKING TABLE (REQUIRED)
CREATE TABLE IF NOT EXISTS "Leveling-Bot_daily_xp" (
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
);

-- 3. VOICE SESSIONS TABLE (REQUIRED)
CREATE TABLE IF NOT EXISTS "Leveling-Bot_voice_sessions" (
    user_id VARCHAR(20) NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    join_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_xp_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_muted BOOLEAN DEFAULT false,
    is_deafened BOOLEAN DEFAULT false,
    PRIMARY KEY (user_id, guild_id)
);

-- 4. GUILD SETTINGS TABLE (REQUIRED FOR CHANNEL CONFIGURATION)
CREATE TABLE IF NOT EXISTS "Leveling-Bot_guild_settings" (
    guild_id VARCHAR(20) PRIMARY KEY,
    levelup_channel VARCHAR(20),
    levelup_enabled BOOLEAN DEFAULT true,
    levelup_ping_user BOOLEAN DEFAULT true,
    xp_log_channel VARCHAR(20),
    xp_log_enabled BOOLEAN DEFAULT false,
    xp_log_messages BOOLEAN DEFAULT false,
    xp_log_reactions BOOLEAN DEFAULT false,
    xp_log_voice BOOLEAN DEFAULT true,
    xp_log_levelup BOOLEAN DEFAULT false,
    message_xp_min INTEGER DEFAULT 75,
    message_xp_max INTEGER DEFAULT 100,
    voice_xp_min INTEGER DEFAULT 250,
    voice_xp_max INTEGER DEFAULT 350,
    reaction_xp_min INTEGER DEFAULT 75,
    reaction_xp_max INTEGER DEFAULT 100,
    daily_xp_cap INTEGER DEFAULT 15000,
    xp_multiplier DECIMAL(3,2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_user_levels_total_xp" ON "Leveling-Bot_user_levels"(guild_id, total_xp DESC);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_user_levels_level" ON "Leveling-Bot_user_levels"(guild_id, level DESC);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_daily_xp_date" ON "Leveling-Bot_daily_xp"(date);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_daily_xp_user_date" ON "Leveling-Bot_daily_xp"(user_id, guild_id, date);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_voice_sessions_guild" ON "Leveling-Bot_voice_sessions"(guild_id);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_voice_sessions_channel" ON "Leveling-Bot_voice_sessions"(channel_id);
CREATE INDEX IF NOT EXISTS "idx_Leveling-Bot_guild_settings_guild" ON "Leveling-Bot_guild_settings"(guild_id);

-- DATA VALIDATION CONSTRAINTS
ALTER TABLE "Leveling-Bot_user_levels" ADD CONSTRAINT IF NOT EXISTS "chk_Leveling-Bot_user_levels_xp_positive" CHECK (total_xp >= 0);
ALTER TABLE "Leveling-Bot_user_levels" ADD CONSTRAINT IF NOT EXISTS "chk_Leveling-Bot_user_levels_level_positive" CHECK (level >= 0);
ALTER TABLE "Leveling-Bot_daily_xp" ADD CONSTRAINT IF NOT EXISTS "chk_Leveling-Bot_daily_xp_positive" CHECK (total_xp >= 0 AND message_xp >= 0 AND voice_xp >= 0 AND reaction_xp >= 0);
ALTER TABLE "Leveling-Bot_guild_settings" ADD CONSTRAINT IF NOT EXISTS "chk_Leveling-Bot_guild_settings_xp_positive" CHECK (message_xp_min > 0 AND message_xp_max > 0 AND voice_xp_min > 0 AND voice_xp_max > 0 AND reaction_xp_min > 0 AND reaction_xp_max > 0 AND daily_xp_cap > 0);

-- SAFE CLEANUP FUNCTION
CREATE OR REPLACE FUNCTION "cleanup_old_Leveling-Bot_daily_xp"()
RETURNS void AS $$
BEGIN
    DELETE FROM "Leveling-Bot_daily_xp" WHERE date < CURRENT_DATE - INTERVAL '30 days';
    RAISE NOTICE 'Leveling-Bot: Cleaned up old daily XP records older than 30 days';
END;
$$ LANGUAGE plpgsql;

-- SAFE AUTOMATIC CLEANUP TRIGGER
CREATE OR REPLACE FUNCTION "trigger_cleanup_Leveling-Bot_daily_xp"()
RETURNS TRIGGER AS $$
BEGIN
    IF random() < 0.01 THEN -- 1% chance
        PERFORM "cleanup_old_Leveling-Bot_daily_xp"();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE THE SAFE TRIGGER
DROP TRIGGER IF EXISTS "Leveling-Bot_cleanup_trigger" ON "Leveling-Bot_daily_xp";
CREATE TRIGGER "Leveling-Bot_cleanup_trigger" 
    AFTER INSERT ON "Leveling-Bot_daily_xp"
    FOR EACH ROW 
    EXECUTE FUNCTION "trigger_cleanup_Leveling-Bot_daily_xp"();

-- USEFUL VIEWS FOR GUILD MANAGEMENT
CREATE OR REPLACE VIEW "Leveling-Bot_current_daily_stats" AS
SELECT 
    dx.*,
    ul.total_xp as lifetime_xp,
    ul.level,
    ul.messages as lifetime_messages,
    ul.reactions as lifetime_reactions,
    ul.voice_time as lifetime_voice_time
FROM "Leveling-Bot_daily_xp" dx
LEFT JOIN "Leveling-Bot_user_levels" ul ON dx.user_id = ul.user_id AND dx.guild_id = ul.guild_id
WHERE dx.date = CURRENT_DATE;

-- VIEW FOR GUILD STATISTICS
CREATE OR REPLACE VIEW "Leveling-Bot_guild_stats" AS
SELECT 
    gs.guild_id,
    gs.levelup_channel,
    gs.xp_log_channel,
    gs.levelup_enabled,
    gs.xp_log_enabled,
    COUNT(DISTINCT ul.user_id) as total_users,
    COUNT(DISTINCT vs.user_id) as active_voice_users,
    MAX(ul.level) as highest_level,
    SUM(ul.total_xp) as total_guild_xp,
    AVG(ul.total_xp) as avg_user_xp
FROM "Leveling-Bot_guild_settings" gs
LEFT JOIN "Leveling-Bot_user_levels" ul ON gs.guild_id = ul.guild_id AND ul.total_xp > 0
LEFT JOIN "Leveling-Bot_voice_sessions" vs ON gs.guild_id = vs.guild_id
GROUP BY gs.guild_id, gs.levelup_channel, gs.xp_log_channel, gs.levelup_enabled, gs.xp_log_enabled;

-- SAMPLE QUERIES FOR TESTING

-- Check if all Leveling-Bot tables exist
-- SELECT tablename FROM pg_tables WHERE tablename LIKE 'Leveling-Bot_%' ORDER BY tablename;

-- Get guild settings for a specific guild
-- SELECT * FROM "Leveling-Bot_guild_settings" WHERE guild_id = 'YOUR_GUILD_ID';

-- Get top users in a guild with settings info
-- SELECT ul.*, gs.levelup_channel, gs.xp_log_channel 
-- FROM "Leveling-Bot_user_levels" ul 
-- LEFT JOIN "Leveling-Bot_guild_settings" gs ON ul.guild_id = gs.guild_id 
-- WHERE ul.guild_id = 'YOUR_GUILD_ID' 
-- ORDER BY ul.total_xp DESC LIMIT 10;

-- Get current daily XP for all users in a guild
-- SELECT dx.*, ul.level FROM "Leveling-Bot_daily_xp" dx
-- LEFT JOIN "Leveling-Bot_user_levels" ul ON dx.user_id = ul.user_id AND dx.guild_id = ul.guild_id
-- WHERE dx.guild_id = 'YOUR_GUILD_ID' AND dx.date = CURRENT_DATE
-- ORDER BY dx.total_xp DESC;

-- GUILD SETTINGS MANAGEMENT FUNCTIONS

-- Function to get or create guild settings
CREATE OR REPLACE FUNCTION "get_or_create_Leveling-Bot_guild_settings"(p_guild_id VARCHAR(20))
RETURNS "Leveling-Bot_guild_settings" AS $$
DECLARE
    result "Leveling-Bot_guild_settings";
BEGIN
    -- Try to get existing settings
    SELECT * INTO result FROM "Leveling-Bot_guild_settings" WHERE guild_id = p_guild_id;
    
    -- If not found, create with defaults
    IF NOT FOUND THEN
        INSERT INTO "Leveling-Bot_guild_settings" (guild_id)
        VALUES (p_guild_id)
        RETURNING * INTO result;
    END IF;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to update guild settings
CREATE OR REPLACE FUNCTION "update_Leveling-Bot_guild_setting"(
    p_guild_id VARCHAR(20),
    p_setting_name VARCHAR(50),
    p_setting_value TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Ensure guild settings exist first
    PERFORM "get_or_create_Leveling-Bot_guild_settings"(p_guild_id);
    
    -- Update specific setting based on setting name
    CASE p_setting_name
        WHEN 'levelup_channel' THEN
            UPDATE "Leveling-Bot_guild_settings" SET levelup_channel = p_setting_value, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'levelup_enabled' THEN
            UPDATE "Leveling-Bot_guild_settings" SET levelup_enabled = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'levelup_ping_user' THEN
            UPDATE "Leveling-Bot_guild_settings" SET levelup_ping_user = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_channel' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_channel = p_setting_value, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_enabled' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_enabled = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_messages' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_messages = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_reactions' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_reactions = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_voice' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_voice = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_log_levelup' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_log_levelup = p_setting_value::BOOLEAN, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'daily_xp_cap' THEN
            UPDATE "Leveling-Bot_guild_settings" SET daily_xp_cap = p_setting_value::INTEGER, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        WHEN 'xp_multiplier' THEN
            UPDATE "Leveling-Bot_guild_settings" SET xp_multiplier = p_setting_value::DECIMAL, updated_at = CURRENT_TIMESTAMP WHERE guild_id = p_guild_id;
        ELSE
            RETURN FALSE; -- Unknown setting
    END CASE;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- MAINTENANCE COMMANDS (SAFE FOR SHARED DATABASE)

-- Clean up old daily XP records manually
-- DELETE FROM "Leveling-Bot_daily_xp" WHERE date < CURRENT_DATE - INTERVAL '30 days';

-- Update database statistics
-- ANALYZE "Leveling-Bot_user_levels";
-- ANALYZE "Leveling-Bot_daily_xp";
-- ANALYZE "Leveling-Bot_voice_sessions";
-- ANALYZE "Leveling-Bot_guild_settings";

-- Check Leveling-Bot table sizes
-- SELECT 
--     tablename,
--     pg_size_pretty(pg_total_relation_size('"' || tablename || '"')) as size
-- FROM pg_tables 
-- WHERE tablename LIKE 'Leveling-Bot_%'
-- ORDER BY pg_total_relation_size('"' || tablename || '"') DESC;

-- BACKUP COMMANDS (ONLY LEVELING-BOT TABLES)
-- pg_dump -h hostname -U username -d database_name -t "Leveling-Bot_user_levels" -t "Leveling-Bot_daily_xp" -t "Leveling-Bot_voice_sessions" -t "Leveling-Bot_guild_settings" > leveling-bot-backup.sql
