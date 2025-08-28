const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Import core systems
console.log('📁 Loading Connection Manager...');
const ConnectionManager = require('./src/systems/ConnectionManager');

console.log('📁 Loading DatabaseManager...');
const DatabaseManager = require('./src/systems/DatabaseManager');

console.log('📁 Loading RedisCacheManager...');
const RedisCacheManager = require('./src/systems/RedisCacheManager');

console.log('📁 Loading XPManager...');
const XPManager = require('./src/systems/XPManager');

console.log('📁 Loading CommandLoader...');
const { loadCommands, registerSlashCommands } = require('./src/utils/CommandLoader');

// Configuration validation
const requiredEnvVars = ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Global managers
let connectionManager;
let databaseManager;
let cacheManager;
let xpManager;

// Initialize all connections and systems
async function initializeBot() {
    try {
        console.log('🚀 Starting One Piece XP Bot initialization...');
        
        // Initialize connection manager first
        connectionManager = new ConnectionManager();
        const connections = await connectionManager.initialize();
        
        console.log('📊 Connection Status:');
        console.log(`   PostgreSQL: ${connections.postgres ? '✅ Connected' : '❌ Failed'}`);
        console.log(`   Redis: ${connections.redis ? '✅ Connected' : '⚠️ Fallback Mode'}`);
        
        if (!connections.postgres) {
            throw new Error('PostgreSQL connection required for bot operation');
        }
        
        // Initialize database manager
        const db = connectionManager.getPostgreSQL();
        databaseManager = new DatabaseManager(db);
        console.log('📋 Initializing database tables...');
        await databaseManager.initializeTables();
        console.log('✅ Database tables initialized');
        
        // Initialize cache manager (works with or without Redis)
        const redis = connectionManager.getRedis();
        cacheManager = new RedisCacheManager(redis, connectionManager);
        await cacheManager.initialize();
        
        if (connections.redis) {
            console.log('✅ Redis cache manager initialized with connection');
            
            // Test cache functionality
            console.log('🧪 Testing cache functionality...');
            const testResult = await cacheManager.testCache();
            if (testResult.success) {
                console.log('✅ Cache test passed - Redis is working correctly');
            } else {
                console.warn('⚠️ Cache test failed:', testResult.error || 'Unknown error');
            }
        } else {
            console.log('⚠️ Cache manager initialized in fallback mode');
        }
        
        // Initialize XP manager with cache support
        xpManager = new XPManager(client, db, cacheManager);
        await xpManager.initialize();
        console.log('✅ XP Manager initialized with cache integration');
        
        // Load commands
        client.commands = new Collection();
        await loadCommands(client);
        
        // Register slash commands
        if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
            await registerSlashCommands(process.env.CLIENT_ID, process.env.DISCORD_TOKEN);
        }
        
        console.log('✅ Bot initialization complete');
        
        // Display connection health
        displayHealthStatus();
        
        // Display cache statistics
        setTimeout(async () => {
            await displayCacheStats();
        }, 5000); // Wait 5 seconds for initial operations
        
    } catch (error) {
        console.error('❌ Bot initialization failed:', error);
        process.exit(1);
    }
}

// Display connection health status
function displayHealthStatus() {
    const health = connectionManager.getHealthStatus();
    
    console.log('\n📊 SYSTEM HEALTH STATUS:');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│            CONNECTION STATUS            │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│ PostgreSQL: ${health.postgresql.status.padEnd(25)} │`);
    console.log(`│ Redis:      ${health.redis.status.padEnd(25)} │`);
    console.log(`│ Cache:      ${health.cache.type.padEnd(25)} │`);
    console.log('└─────────────────────────────────────────┘');
    
    if (health.redis.fallbackActive) {
        console.log('⚠️  NOTICE: Redis unavailable - using in-memory fallback');
        console.log('   • Bot is fully functional but without caching optimizations');
        console.log('   • Canvas generation will be slower');
        console.log('   • User stats queries will hit database directly');
    }
    console.log('');
}

// Display cache statistics
async function displayCacheStats() {
    try {
        console.log('📊 CACHE STATISTICS:');
        console.log('┌─────────────────────────────────────────┐');
        console.log('│             CACHE STATUS                │');
        console.log('├─────────────────────────────────────────┤');
        
        if (cacheManager) {
            const stats = await cacheManager.getCacheStats();
            console.log(`│ Mode:       ${stats.mode.padEnd(25)} │`);
            console.log(`│ Redis:      ${(stats.redis ? 'Available' : 'Unavailable').padEnd(25)} │`);
            console.log(`│ Entries:    ${String(stats.total || stats.entries || 0).padEnd(25)} │`);
            
            if (stats.redis) {
                console.log(`│ Avatars:    ${String(stats.avatars || 0).padEnd(25)} │`);
                console.log(`│ Posters:    ${String(stats.posters || 0).padEnd(25)} │`);
                console.log(`│ Cooldowns:  ${String(stats.cooldowns || 0).padEnd(25)} │`);
                console.log(`│ L-boards:   ${String(stats.leaderboards || 0).padEnd(25)} │`);
                if (stats.memoryUsed) {
                    console.log(`│ Memory:     ${String(stats.memoryUsed).padEnd(25)} │`);
                }
            }
        } else {
            console.log('│ Cache:      Not Available               │');
        }
        
        console.log('└─────────────────────────────────────────┘');
        console.log('');
    } catch (error) {
        console.error('Error displaying cache stats:', error);
    }
}

// CACHE PRELOADING SYSTEM
async function startCachePreloading() {
    try {
        // Only preload if Redis is available
        if (!cacheManager || !connectionManager?.isRedisAvailable()) {
            console.log('🔄 [PRELOAD] Redis not available, skipping cache preloading');
            return;
        }

        console.log('🚀 [PRELOAD] Starting cache preloading system in 30 seconds...');
        console.log('🚀 [PRELOAD] This will improve leaderboard and poster generation speed');
        
        // Wait for bot to fully settle, then start preloading
        setTimeout(async () => {
            console.log('🔄 [PRELOAD] Beginning cache preloading...');
            
            try {
                const preloadSuccess = await cacheManager.preloadCache(client, databaseManager);
                
                if (preloadSuccess) {
                    const stats = cacheManager.getPreloadStats();
                    console.log('✅ [PRELOAD] Cache preloading completed successfully!');
                    console.log(`✅ [PRELOAD] Performance boost ready: ${stats.avatarsPreloaded + stats.postersPreloaded} items cached`);
                    
                    // Display updated cache stats after preloading
                    setTimeout(async () => {
                        await displayCacheStats();
                    }, 2000);
                } else {
                    console.log('⚠️ [PRELOAD] Cache preloading completed with issues');
                }
            } catch (preloadError) {
                console.error('❌ [PRELOAD] Cache preloading failed:', preloadError);
            }
        }, 30000); // 30 seconds delay to let bot settle
        
    } catch (error) {
        console.error('❌ [PRELOAD] Error starting cache preloading:', error);
    }
}

// Bot ready event - ENHANCED WITH CACHE PRELOADING
client.once('clientReady', async () => {
    console.log('🏴‍☠️ ═══════════════════════════════════════');
    console.log('🏴‍☠️           ONE PIECE XP BOT');
    console.log('🏴‍☠️ ═══════════════════════────');
    console.log(`⚓ Logged in as ${client.user.tag}`);
    console.log(`🏴‍☠️ Serving ${client.guilds.cache.size} server(s)`);
    console.log(`🎯 Commands loaded: ${client.commands.size}`);
    
    const health = connectionManager.getHealthStatus();
    console.log(`📊 PostgreSQL: ${health.postgresql.status}`);
    console.log(`🔴 Redis: ${health.redis.status}`);
    console.log(`💾 Cache: ${health.cache.type}`);
    
    console.log('🏴‍☠️ ═══════════════════════════════════════');
    console.log('🎯 All systems operational!');
    console.log('🏴‍☠️ ═══════════════════════════════════════');
    
    // Update cache stats display after bot is fully ready
    setTimeout(async () => {
        await displayCacheStats();
    }, 10000); // Wait 10 seconds for systems to settle

    // START CACHE PRELOADING SYSTEM
    await startCachePreloading();
});

// Message event with ENHANCED DEBUG COMMANDS
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Handle XP for messages
    if (xpManager) {
        await xpManager.handleMessageXP(message);
    }
    
    // Legacy ping command for testing connections
    if (message.content === '!ping') {
        const ping = Date.now() - message.createdTimestamp;
        const health = connectionManager.getHealthStatus();
        
        const embed = {
            color: 0xFF0000,
            title: '🏴‍☠️ **Marine Intelligence System Status**',
            description: '```diff\n- SYSTEM DIAGNOSTICS REPORT\n```',
            fields: [
                {
                    name: '📡 **Latency**',
                    value: `**Bot:** \`${ping}ms\`\n**API:** \`${Math.round(client.ws.ping)}ms\``,
                    inline: true
                },
                {
                    name: '🗄️ **Database**',
                    value: `**PostgreSQL:** ${health.postgresql.status}\n**Cache:** ${health.cache.type}`,
                    inline: true
                },
                {
                    name: '⚙️ **Performance**',
                    value: `**Mode:** ${health.redis.connected ? 'Optimized' : 'Standard'}\n**Fallback:** ${health.redis.fallbackActive ? 'Active' : 'Inactive'}`,
                    inline: true
                }
            ],
            footer: { text: '⚓ Marine Intelligence Division • System Monitor' },
            timestamp: new Date().toISOString()
        };
        
        await message.reply({ embeds: [embed] });
    }

    // ==================== NEW REDIS DEBUG COMMANDS ====================
    
    // Debug command to check actual Redis keys
    if (message.content === '!rediskeys' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🔍 Checking actual Redis keys...');
            
            if (!connectionManager || !connectionManager.isRedisAvailable()) {
                return await message.reply('❌ Redis not available');
            }
            
            const redis = connectionManager.getRedis();
            
            // Get ALL keys in Redis (not just bot keys)
            const allKeys = await redis.keys('*');
            console.log(`[REDIS DEBUG] Found ${allKeys.length} total keys in Redis`);
            
            // Show first 20 keys for debugging
            const sampleKeys = allKeys.slice(0, 20);
            console.log('[REDIS DEBUG] Sample keys:', sampleKeys);
            
            // Check for Leveling-Bot prefixed keys
            const botKeys = await redis.keys('Leveling-Bot:*');
            console.log(`[REDIS DEBUG] Found ${botKeys.length} Leveling-Bot keys`);
            
            // Check for other common prefixes
            const prefixChecks = [
                'leveling-bot:*',
                'levelingbot:*',
                'bot:*',
                'xp:*',
                'cache:*',
                'discord:*'
            ];
            
            for (const prefix of prefixChecks) {
                const keys = await redis.keys(prefix);
                if (keys.length > 0) {
                    console.log(`[REDIS DEBUG] Found ${keys.length} keys with prefix "${prefix.replace('*', '')}"`);
                    console.log(`[REDIS DEBUG] Sample: ${keys.slice(0, 3)}`);
                }
            }
            
            const embed = {
                color: 0x4A90E2,
                title: '🔍 Redis Keys Debug',
                description: '```diff\n+ REDIS KEY ANALYSIS\n```',
                fields: [
                    {
                        name: '📊 Key Counts',
                        value: `**Total Keys:** ${allKeys.length}\n**Leveling-Bot Keys:** ${botKeys.length}`,
                        inline: false
                    },
                    {
                        name: '🔍 Sample Keys (First 10)',
                        value: sampleKeys.slice(0, 10).map(key => `\`${key}\``).join('\n') || 'No keys found',
                        inline: false
                    }
                ],
                footer: { text: 'Check console for detailed analysis' }
            };
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            await message.reply(`❌ Redis debug error: ${error.message}`);
        }
    }

    // Debug command to check what patterns the bot is searching for
    if (message.content === '!cachepatterns' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🔍 Checking bot cache search patterns...');
            
            if (!cacheManager) {
                return await message.reply('❌ Cache manager not available');
            }
            
            const keyPrefix = cacheManager.keyPrefix || 'Leveling-Bot:';
            
            console.log('[CACHE DEBUG] Bot is using key prefix:', keyPrefix);
            
            // Test the exact patterns the bot searches for
            const patterns = [
                `${keyPrefix}avatar:*`,
                `${keyPrefix}poster:*`,
                `${keyPrefix}cooldown:*`,
                `${keyPrefix}leaderboard:*`,
                `${keyPrefix}validated:*`
            ];
            
            const embed = {
                color: 0x4A90E2,
                title: '🔍 Bot Cache Patterns',
                description: '```diff\n+ BOT SEARCH PATTERNS\n```',
                fields: [
                    {
                        name: '🏷️ Key Prefix',
                        value: `\`${keyPrefix}\``,
                        inline: false
                    },
                    {
                        name: '🔍 Search Patterns',
                        value: patterns.map(p => `\`${p}\``).join('\n'),
                        inline: false
                    }
                ],
                footer: { text: 'These are the patterns the bot searches for' }
            };
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            await message.reply(`❌ Pattern debug error: ${error.message}`);
        }
    }

    // Debug command to manually check pattern matching
    if (message.content === '!testpatterns' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🧪 Testing pattern matching...');
            
            if (!connectionManager || !connectionManager.isRedisAvailable()) {
                return await message.reply('❌ Redis not available');
            }
            
            const redis = connectionManager.getRedis();
            const keyPrefix = cacheManager?.keyPrefix || 'Leveling-Bot:';
            
            // Test each pattern individually
            const testResults = [];
            
            const patterns = [
                `${keyPrefix}avatar:*`,
                `${keyPrefix}poster:*`,
                `${keyPrefix}cooldown:*`,
                `${keyPrefix}leaderboard:*`,
                `${keyPrefix}validated:*`,
                // Also test without prefix
                'avatar:*',
                'poster:*',
                'cooldown:*',
                // Test other possible prefixes
                'leveling-bot:*',
                'bot:*'
            ];
            
            for (const pattern of patterns) {
                const keys = await redis.keys(pattern);
                testResults.push(`**${pattern}:** ${keys.length} keys`);
                
                if (keys.length > 0) {
                    console.log(`[PATTERN TEST] ${pattern} found ${keys.length} keys:`, keys.slice(0, 3));
                }
            }
            
            const embed = {
                color: testResults.some(r => r.includes(': 0 keys')) ? 0xFF6B6B : 0x00FF00,
                title: '🧪 Pattern Test Results',
                description: '```diff\n+ PATTERN MATCHING TEST\n```',
                fields: [
                    {
                        name: '🔍 Results',
                        value: testResults.join('\n'),
                        inline: false
                    }
                ],
                footer: { text: 'Check console for sample keys found' }
            };
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            await message.reply(`❌ Pattern test error: ${error.message}`);
        }
    }

    // Debug command to check Redis database
    if (message.content === '!redisdb' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            if (!connectionManager || !connectionManager.isRedisAvailable()) {
                return await message.reply('❌ Redis not available');
            }
            
            const redis = connectionManager.getRedis();
            
            // Check current database
            const info = await redis.info('keyspace');
            console.log('[REDIS DB] Keyspace info:', info);
            
            // Check what database we're connected to
            const dbInfo = info.split('\n').filter(line => line.startsWith('db'));
            
            let currentDb = 'Unknown';
            try {
                // Try to determine current DB (this is tricky with ioredis)
                const config = redis.options;
                currentDb = config.db || 0;
            } catch (error) {
                console.log('[REDIS DB] Could not determine current DB');
            }
            
            const embed = {
                color: 0x4A90E2,
                title: '🗄️ Redis Database Info',
                description: '```diff\n+ DATABASE INFORMATION\n```',
                fields: [
                    {
                        name: '📊 Current Database',
                        value: `Database: ${currentDb}`,
                        inline: true
                    },
                    {
                        name: '🔍 Keyspace Info',
                        value: dbInfo.length > 0 ? dbInfo.join('\n') : 'No database info available',
                        inline: false
                    }
                ],
                footer: { text: 'Check console for detailed keyspace info' }
            };
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            await message.reply(`❌ Database info error: ${error.message}`);
        }
    }
    
    // ==================== EXISTING DEBUG COMMANDS ====================
    
    // Admin cache test command
    if (message.content === '!cachetest' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            const testResult = await xpManager.testCache();
            const stats = await xpManager.getCacheStats();
            
            const embed = {
                color: testResult.success ? 0x00FF00 : 0xFF0000,
                title: '🧪 **Cache Test Results**',
                description: testResult.success ? 
                    '```diff\n+ Cache test passed successfully\n```' : 
                    '```diff\n- Cache test failed\n```',
                fields: [
                    {
                        name: '📊 **Cache Stats**',
                        value: `**Mode:** ${stats.mode}\n**Redis:** ${stats.redis ? 'Connected' : 'Disconnected'}\n**Entries:** ${stats.total || stats.entries || 0}`,
                        inline: true
                    },
                    {
                        name: '🧪 **Test Result**',
                        value: testResult.success ? 
                            `✅ ${testResult.message || 'Test passed'}` : 
                            `❌ ${testResult.error || 'Test failed'}`,
                        inline: true
                    }
                ],
                footer: { text: '⚓ Marine Intelligence Division • Cache Test' },
                timestamp: new Date().toISOString()
            };
            
            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Cache test error: ${error.message}`);
        }
    }

    // Admin cache preload command
    if (message.content === '!preload' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            if (cacheManager.isPreloading()) {
                return await message.reply('⚠️ Cache preloading is already in progress!');
            }

            await message.reply('🚀 Starting manual cache preloading...');
            
            const preloadSuccess = await cacheManager.preloadCache(client, databaseManager);
            const stats = cacheManager.getPreloadStats();
            
            const embed = {
                color: preloadSuccess ? 0x00FF00 : 0xFFA500,
                title: '🔄 **Manual Cache Preload Results**',
                description: preloadSuccess ? 
                    '```diff\n+ Cache preloading completed successfully\n```' : 
                    '```diff\n! Cache preloading completed with issues\n```',
                fields: [
                    {
                        name: '📊 **Preload Statistics**',
                        value: `**Total Users:** ${stats.totalUsers}\n**Avatars Cached:** ${stats.avatarsPreloaded}\n**Posters Cached:** ${stats.postersPreloaded}\n**Errors:** ${stats.errors}`,
                        inline: true
                    },
                    {
                        name: '⏱️ **Performance**',
                        value: `**Duration:** ${((stats.endTime - stats.startTime) / 1000).toFixed(2)}s\n**Rate:** ${Math.round(stats.totalUsers / ((stats.endTime - stats.startTime) / 1000))} users/sec`,
                        inline: true
                    }
                ],
                footer: { text: '⚓ Marine Intelligence Division • Manual Cache Preload' },
                timestamp: new Date().toISOString()
            };
            
            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Cache preload error: ${error.message}`);
        }
    }
    
    // Admin health check command
    if (message.content === '!health' && message.author.id === process.env.ADMIN_USER_ID) {
        const testResults = await connectionManager.testConnections();
        const health = connectionManager.getHealthStatus();
        
        let healthDescription = '```diff\n';
        healthDescription += testResults.postgresql ? '+ PostgreSQL: Connection Test Passed\n' : '- PostgreSQL: Connection Test Failed\n';
        healthDescription += testResults.redis ? '+ Redis: Connection Test Passed\n' : '! Redis: Using Fallback Mode\n';
        healthDescription += '```';
        
        const embed = {
            color: testResults.postgresql ? 0x00FF00 : 0xFF0000,
            title: '🏥 **System Health Check**',
            description: healthDescription,
            fields: [
                {
                    name: '📊 **Detailed Status**',
                    value: `**PostgreSQL:** ${health.postgresql.status}\n**Redis:** ${health.redis.status}\n**Cache:** ${health.cache.type}`,
                    inline: false
                }
            ],
            footer: { text: `Test completed at ${testResults.timestamp}` }
        };
        
        await message.reply({ embeds: [embed] });
    }

    // Enhanced cache debug command - COMPREHENSIVE DIAGNOSTICS
    if (message.content === '!cachedebug' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            const stats = await cacheManager.getCacheStats();
            const redis = connectionManager.getRedis();
            
            // Get raw Redis key count
            let redisKeyCount = 0;
            let redisKeys = [];
            if (redis) {
                const allKeys = await redis.keys('Leveling-Bot:*');
                redisKeyCount = allKeys.length;
                redisKeys = allKeys.slice(0, 10); // Show first 10 keys
            }
            
            const embed = {
                color: 0x4A90E2,
                title: '🔍 **Comprehensive Cache Debug Information**',
                description: '```diff\n+ DETAILED CACHE DIAGNOSIS\n```',
                fields: [
                    {
                        name: '🔴 **Redis Connection**',
                        value: `**Available:** ${connectionManager.isRedisAvailable()}\n**Direct Keys:** ${redisKeyCount}\n**Stats Keys:** ${stats.total || 0}`,
                        inline: true
                    },
                    {
                        name: '📊 **Key Breakdown**',
                        value: `**Avatar Pattern:** ${await cacheManager.countKeys('Leveling-Bot:avatar:*')}\n**Poster Pattern:** ${await cacheManager.countKeys('Leveling-Bot:poster:*')}\n**Cooldown Pattern:** ${await cacheManager.countKeys('Leveling-Bot:cooldown:*')}`,
                        inline: true
                    },
                    {
                        name: '🔍 **Sample Keys**',
                        value: redisKeys.length > 0 ? redisKeys.slice(0, 5).map(key => `\`${key.replace('Leveling-Bot:', '')}\``).join('\n') : 'No keys found',
                        inline: false
                    },
                    {
                        name: '🚀 **Preload Status**',
                        value: `**In Progress:** ${cacheManager.isPreloading()}\n**Total Users:** ${cacheManager.getPreloadStats().totalUsers}\n**Avatars:** ${cacheManager.getPreloadStats().avatarsPreloaded}\n**Posters:** ${cacheManager.getPreloadStats().postersPreloaded}`,
                        inline: false
                    }
                ],
                footer: { text: '⚓ Marine Intelligence Division • Cache Debug' },
                timestamp: new Date().toISOString()
            };
            
            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Cache debug error: ${error.message}`);
        }
    }

    // Rest of existing debug commands...
    if (message.content === '!cachemanualtest' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🧪 Starting manual cache test...');
            
            if (cacheManager && typeof cacheManager.manualCacheTest === 'function') {
                await cacheManager.manualCacheTest();
                await message.reply('✅ Manual cache test completed - check console logs');
            } else {
                await message.reply('❌ Manual cache test not available');
            }
        } catch (error) {
            await message.reply(`❌ Cache test error: ${error.message}`);
        }
    }

    if (message.content === '!cachecontents' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🔍 Debugging cache contents...');
            
            if (cacheManager && typeof cacheManager.debugCacheContents === 'function') {
                await cacheManager.debugCacheContents();
                await message.reply('✅ Cache contents debug completed - check console logs');
            } else {
                await message.reply('❌ Cache contents debug not available');
            }
        } catch (error) {
            await message.reply(`❌ Cache contents debug error: ${error.message}`);
        }
    }

    if (message.content.startsWith('!preloaduser ') && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            const userId = message.content.split(' ')[1];
            if (!userId) {
                return await message.reply('❌ Usage: !preloaduser <user_id>');
            }

            await message.reply(`🚀 Force preloading user ${userId}...`);
            
            if (cacheManager && typeof cacheManager.debugPreloadUser === 'function') {
                const result = await cacheManager.debugPreloadUser(message.guild, userId);
                if (result) {
                    await message.reply(`✅ Successfully preloaded user ${userId}`);
                } else {
                    await message.reply(`❌ Failed to preload user ${userId}`);
                }
            } else {
                await message.reply('❌ User preload debug not available');
            }
        } catch (error) {
            await message.reply(`❌ User preload error: ${error.message}`);
        }
    }

    // Clear cache command (USE WITH CAUTION)
    if (message.content === '!clearcache' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('⚠️ **WARNING:** This will clear ALL cache data. Type `!clearcache confirm` to proceed.');
        } catch (error) {
            await message.reply(`❌ Error: ${error.message}`);
        }
    }

    if (message.content === '!clearcache confirm' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🧹 Clearing all cache data...');
            
            if (cacheManager && typeof cacheManager.debugClearAllCache === 'function') {
                const cleared = await cacheManager.debugClearAllCache();
                if (cleared !== false) {
                    await message.reply(`✅ Cleared ${cleared} cache entries`);
                } else {
                    await message.reply('❌ Failed to clear cache');
                }
            } else {
                await message.reply('❌ Cache clear not available');
            }
        } catch (error) {
            await message.reply(`❌ Cache clear error: ${error.message}`);
        }
    }

    // Advanced cache statistics command
    if (message.content === '!cachestats' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            const stats = await cacheManager.getCacheStats();
            const preloadStats = cacheManager.getPreloadStats();
            
            const embed = {
                color: 0x4A90E2,
                title: '📊 **Detailed Cache Statistics**',
                description: '```diff\n+ CACHE PERFORMANCE REPORT\n```',
                fields: [
                    {
                        name: '🔴 **Redis Status**',
                        value: `**Mode:** ${stats.mode}\n**Connected:** ${stats.redis ? 'Yes' : 'No'}\n**Total Entries:** ${stats.total || 0}`,
                        inline: true
                    },
                    {
                        name: '📊 **Cache Breakdown**',
                        value: `**Avatars:** ${stats.avatars || 0}\n**Posters:** ${stats.posters || 0}\n**Cooldowns:** ${stats.cooldowns || 0}\n**Leaderboards:** ${stats.leaderboards || 0}`,
                        inline: true
                    },
                    {
                        name: '🚀 **Preload Stats**',
                        value: `**Users Processed:** ${preloadStats.totalUsers || 0}\n**Avatars Preloaded:** ${preloadStats.avatarsPreloaded || 0}\n**Posters Preloaded:** ${preloadStats.postersPreloaded || 0}\n**Errors:** ${preloadStats.errors || 0}`,
                        inline: false
                    }
                ],
                footer: { text: '⚓ Marine Intelligence Division • Cache Analytics' },
                timestamp: new Date().toISOString()
            };
            
            if (stats.memoryUsed) {
                embed.fields.push({
                    name: '💾 **Memory Usage**',
                    value: `**Redis Memory:** ${stats.memoryUsed}`,
                    inline: true
                });
            }
            
            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Cache stats error: ${error.message}`);
        }
    }

    // Test cache functionality with actual operations
    if (message.content === '!testcachefull' && message.author.id === process.env.ADMIN_USER_ID) {
        try {
            await message.reply('🧪 Starting comprehensive cache functionality test...');
            
            // Test avatar caching
            const user = message.author;
            const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
            console.log(`[CACHE TEST] Testing avatar caching for ${user.username}`);
            console.log(`[CACHE TEST] Avatar URL: ${avatarURL}`);
            
            // Try to extract avatar hash
            const avatarHash = cacheManager.extractAvatarHash ? cacheManager.extractAvatarHash(avatarURL) : 'test-hash';
            console.log(`[CACHE TEST] Avatar hash: ${avatarHash}`);
            
            // Test basic cache operations
            const testResults = [];
            
            // Test 1: Basic string cache
            try {
                const testKey = `${cacheManager.keyPrefix}test:basic:${Date.now()}`;
                const testValue = JSON.stringify({ test: true, user: user.username });
                
                const setResult = await connectionManager.setCache(testKey, testValue, 300);
                const getResult = await connectionManager.getCache(testKey);
                
                testResults.push(`**Basic Cache:** ${setResult && getResult ? '✅ PASS' : '❌ FAIL'}`);
            } catch (error) {
                testResults.push(`**Basic Cache:** ❌ ERROR - ${error.message}`);
            }
            
            // Test 2: Binary cache (simulate avatar)
            try {
                const testKey = `${cacheManager.keyPrefix}test:binary:${Date.now()}`;
                const testBuffer = Buffer.from('test-image-data-simulation');
                
                const setResult = await connectionManager.setBinaryCache(testKey, testBuffer, 300);
                const getResult = await connectionManager.getBinaryCache(testKey);
                
                testResults.push(`**Binary Cache:** ${setResult && getResult && Buffer.isBuffer(getResult) ? '✅ PASS' : '❌ FAIL'}`);
            } catch (error) {
                testResults.push(`**Binary Cache:** ❌ ERROR - ${error.message}`);
            }
            
            // Test 3: Pattern clearing
            try {
                const testPattern = `${cacheManager.keyPrefix}test:pattern:*`;
                const testKey1 = `${cacheManager.keyPrefix}test:pattern:1`;
                const testKey2 = `${cacheManager.keyPrefix}test:pattern:2`;
                
                await connectionManager.setCache(testKey1, 'test1', 300);
                await connectionManager.setCache(testKey2, 'test2', 300);
                
                const clearedCount = await connectionManager.clearPattern(testPattern);
                
                testResults.push(`**Pattern Clear:** ${clearedCount >= 2 ? '✅ PASS' : '❌ FAIL'} (cleared ${clearedCount})`);
            } catch (error) {
                testResults.push(`**Pattern Clear:** ❌ ERROR - ${error.message}`);
            }
            
            const embed = {
                color: testResults.every(r => r.includes('✅')) ? 0x00FF00 : 0xFF6B6B,
                title: '🧪 **Comprehensive Cache Test Results**',
                description: '```diff\n+ CACHE FUNCTIONALITY VERIFICATION\n```',
                fields: [
                    {
                        name: '📊 **Test Results**',
                        value: testResults.join('\n'),
                        inline: false
                    },
                    {
                        name: '🔍 **Connection Info**',
                        value: `**Redis Available:** ${connectionManager.isRedisAvailable()}\n**Cache Mode:** ${(await cacheManager.getCacheStats()).mode}\n**Test User:** ${user.username}`,
                        inline: false
                    }
                ],
                footer: { text: '⚓ Marine Intelligence Division • Cache Functionality Test' },
                timestamp: new Date().toISOString()
            };
            
            await message.reply({ embeds: [embed] });
            
        } catch (error) {
            await message.reply(`❌ Comprehensive cache test error: ${error.message}`);
        }
    }
});

// Reaction event
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || !reaction.message.guild) return;
    
    if (xpManager) {
        await xpManager.handleReactionXP(reaction, user);
    }
});

// Voice state update event
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (xpManager) {
        await xpManager.handleVoiceStateUpdate(oldState, newState);
    }
});

// Guild member update event (for tier role changes affecting daily caps)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if roles changed
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        
        // Compare role collections to see if any roles were added/removed
        if (oldRoles.size !== newRoles.size || 
            !oldRoles.every(role => newRoles.has(role.id))) {
            
            console.log(`[ROLE CHANGE] Detected role change for ${newMember.user.username}`);
            
            // Invalidate cache when user roles change (affects daily caps and potentially avatars)
            if (cacheManager) {
                await cacheManager.invalidateGuildCache(newMember.guild.id);
                await cacheManager.invalidateUserDailyProgress(
                    newMember.user.id, 
                    newMember.guild.id, 
                    cacheManager.getCurrentDateKey()
                );
            }
            
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
                        console.log(`[ROLE CHANGE] ${newMember.user.username} gained Tier ${tier} role`);
                    } else {
                        console.log(`[ROLE CHANGE] ${newMember.user.username} lost Tier ${tier} role`);
                    }
                }
            }
            
            // If tier roles changed, handle daily cap adjustment and cache invalidation
            if (tierRoleChanged && xpManager && xpManager.dailyCapManager) {
                await xpManager.dailyCapManager.handleRoleChange(newMember, oldRoles, newRoles);
            }
        }
    } catch (error) {
        console.error('Error handling guild member update:', error);
    }
});

// Guild member remove event (invalidate cache when users leave)
client.on('guildMemberRemove', async (member) => {
    try {
        console.log(`[MEMBER LEAVE] ${member.user.username} left ${member.guild.name}`);
        
        // Invalidate relevant caches when users leave
        if (cacheManager) {
            // Invalidate guild-wide caches (leaderboard, validated users)
            await cacheManager.invalidateGuildCache(member.guild.id);
            
            // Invalidate user-specific caches (posters, daily progress)
            await cacheManager.invalidateUserPosters(member.user.id);
            await cacheManager.invalidateUserDailyProgress(
                member.user.id, 
                member.guild.id, 
                cacheManager.getCurrentDateKey()
            );
            
            console.log(`[CACHE] Invalidated caches for user ${member.user.username} who left`);
        }
    } catch (error) {
        console.error('Error handling guild member remove:', error);
    }
});

// Slash command and button interaction handler
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            console.log(`[INTERACTION] Processing slash command: ${interaction.commandName} by ${interaction.user.username}`);
            
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`[INTERACTION] Command not found: ${interaction.commandName}`);
                return;
            }

            try {
                await command.execute(interaction, { 
                    xpManager, 
                    databaseManager, 
                    cacheManager,
                    connectionManager 
                });
                console.log(`[INTERACTION] ✅ Successfully executed command: ${interaction.commandName}`);
            } catch (error) {
                console.error(`[INTERACTION] ❌ Error executing command ${interaction.commandName}:`, error);
                
                const errorMessage = '❌ There was an error executing this command!';
                
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                } catch (replyError) {
                    console.error(`[INTERACTION] ❌ Failed to send error response:`, replyError);
                }
            }
        } else if (interaction.isButton()) {
            console.log(`[BUTTON] Processing button interaction: ${interaction.customId} by ${interaction.user.username}`);
            
            // Handle button interactions for leaderboard navigation
            if (interaction.customId.startsWith('leaderboard_')) {
                const leaderboardCommand = client.commands.get('leaderboard');
                
                if (leaderboardCommand) {
                    try {
                        // Pass the button interaction directly - the command will handle it properly
                        await leaderboardCommand.execute(interaction, { 
                            xpManager, 
                            databaseManager, 
                            cacheManager,
                            connectionManager 
                        });
                        console.log(`[BUTTON] ✅ Successfully executed leaderboard button: ${interaction.customId}`);
                    } catch (error) {
                        console.error(`[BUTTON] ❌ Error handling leaderboard button ${interaction.customId}:`, error);
                        
                        try {
                            if (interaction.replied || interaction.deferred) {
                                await interaction.followUp({ 
                                    content: '❌ There was an error processing your request!', 
                                    ephemeral: true 
                                });
                            } else {
                                await interaction.reply({ 
                                    content: '❌ There was an error processing your request!', 
                                    ephemeral: true 
                                });
                            }
                        } catch (replyError) {
                            console.error(`[BUTTON] ❌ Error sending button error message:`, replyError);
                        }
                    }
                } else {
                    console.error(`[BUTTON] ❌ Leaderboard command not found for button interaction`);
                    try {
                        await interaction.reply({ 
                            content: '❌ Command not found!', 
                            ephemeral: true 
                        });
                    } catch (replyError) {
                        console.error(`[BUTTON] ❌ Error sending button not found message:`, replyError);
                    }
                }
            } else {
                console.log(`[BUTTON] ⚠️ Unknown button interaction: ${interaction.customId}`);
            }
        } else {
            console.log(`[INTERACTION] ⚠️ Unknown interaction type: ${interaction.type}`);
        }
    } catch (error) {
        console.error(`[INTERACTION] ❌ Critical error in interaction handler:`, error);
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

client.on('warn', warning => {
    console.warn('⚠️ Discord client warning:', warning);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
    
    // If it's a connection error, try to reconnect
    if (error.message && error.message.includes('Redis')) {
        console.log('🔄 Attempting Redis reconnection...');
        connectionManager?.reconnectRedis();
    }
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    console.log('🛑 Shutting down bot gracefully...');
    
    try {
        if (xpManager) {
            await xpManager.cleanup();
        }
        
        if (cacheManager) {
            await cacheManager.cleanup();
        }
        
        if (connectionManager) {
            await connectionManager.shutdown();
        }
        
        client.destroy();
        console.log('👋 Bot shutdown complete!');
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
    }
    
    process.exit(0);
}

// Periodic health checks (every 30 minutes)
setInterval(async () => {
    try {
        if (connectionManager) {
            const health = connectionManager.getHealthStatus();
            
            // Log status if there are issues
            if (!health.postgresql.connected) {
                console.error('❌ PostgreSQL connection lost!');
            }
            
            if (!health.redis.connected && connectionManager.isRedisAvailable()) {
                console.warn('⚠️ Redis connection lost, attempting reconnection...');
                await connectionManager.reconnectRedis();
            }
        }
    } catch (error) {
        console.error('❌ Health check error:', error);
    }
}, 1800000); // 30 minutes

// Periodic cache stats (every 30 minutes) with performance insights
setInterval(async () => {
    try {
        if (cacheManager) {
            const stats = await cacheManager.getCacheStats();
            const preloadStats = cacheManager.getPreloadStats();
            
            console.log(`📊 [CACHE STATS] Mode: ${stats.mode}, Entries: ${stats.total || stats.entries || 0}`);
            
            if (stats.redis && stats.total > 0) {
                console.log(`📊 [CACHE BREAKDOWN] Avatars: ${stats.avatars || 0}, Posters: ${stats.posters || 0}, Cooldowns: ${stats.cooldowns || 0}, Leaderboards: ${stats.leaderboards || 0}`);
                
                // Performance insights
                if (preloadStats.totalUsers > 0) {
                    console.log(`🚀 [PERFORMANCE] Preloaded: ${preloadStats.avatarsPreloaded + preloadStats.postersPreloaded} items, Users: ${preloadStats.totalUsers}`);
                }
                
                // Cache hit rate estimation (avatars + posters vs total users processed)
                if (preloadStats.totalUsers > 0) {
                    const cacheHitRate = Math.round(((stats.avatars || 0) + (stats.posters || 0)) / preloadStats.totalUsers * 100);
                    console.log(`⚡ [PERFORMANCE] Estimated cache efficiency: ${cacheHitRate}%`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Cache stats error:', error);
    }
}, 1800000); // 30 minutes

// Start the bot
async function startBot() {
    console.log('🚀 Starting One Piece XP Bot...');
    
    await initializeBot();
    await client.login(process.env.DISCORD_TOKEN);
}

// Export for other modules
module.exports = { 
    client, 
    databaseManager, 
    xpManager, 
    cacheManager, 
    connectionManager 
};

// Start the bot
startBot().catch(console.error);
