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
        if (redis) {
            cacheManager = new RedisCacheManager(redis, connectionManager);
            console.log('✅ Redis cache manager initialized');
        } else {
            cacheManager = new RedisCacheManager(null, connectionManager); // Fallback mode
            console.log('⚠️ Cache manager initialized in fallback mode');
        }
        
        // Initialize XP manager with cache support
        xpManager = new XPManager(client, db, cacheManager);
        await xpManager.initialize();
        console.log('✅ XP Manager initialized');
        
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

// Bot ready event
client.once('ready', async () => {
    console.log('🏴‍☠️ ═══════════════════════════════════════');
    console.log('🏴‍☠️           ONE PIECE XP BOT');
    console.log('🏴‍☠️ ═══════════════════════════────────────');
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
});

// Message event
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
                
                // Invalidate cache for this user's daily progress
                if (cacheManager) {
                    const currentDate = cacheManager.getCurrentDateKey();
                    await cacheManager.invalidateUserDailyProgress(
                        newMember.user.id, 
                        newMember.guild.id, 
                        currentDate
                    );
                }
            }
        }
    } catch (error) {
        console.error('Error handling guild member update:', error);
    }
});

// Slash command handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, { 
                xpManager, 
                databaseManager, 
                cacheManager,
                connectionManager 
            });
        } catch (error) {
            console.error(`Error executing command ${interaction.commandName}:`, error);
            
            const errorMessage = '❌ There was an error executing this command!';
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        // Handle button interactions for leaderboard navigation
        if (interaction.customId.startsWith('leaderboard_')) {
            const type = interaction.customId.replace('leaderboard_', '');
            const leaderboardCommand = client.commands.get('leaderboard');
            
            if (leaderboardCommand) {
                // Create a mock interaction with the type option
                const mockInteraction = {
                    ...interaction,
                    options: {
                        getString: (name) => name === 'type' ? type : null
                    }
                };
                
                try {
                    await leaderboardCommand.execute(mockInteraction, { 
                        xpManager, 
                        databaseManager, 
                        cacheManager,
                        connectionManager 
                    });
                } catch (error) {
                    console.error('Error handling leaderboard button:', error);
                    await interaction.reply({ 
                        content: '❌ There was an error processing your request!', 
                        ephemeral: true 
                    });
                }
            }
        }
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

// Periodic health checks (every 5 minutes)
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
}, 300000); // 5 minutes

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
