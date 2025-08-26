const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Import core systems
const XPManager = require('./src/systems/XPManager');
const DatabaseManager = require('./src/systems/DatabaseManager');
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
let databaseManager;
let xpManager;

// Initialize database connection
async function initializeDatabase() {
    try {
        console.log('🗄️ Connecting to PostgreSQL...');
        
        const db = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        // Test connection
        const client = await db.connect();
        const result = await client.query('SELECT NOW()');
        console.log(`✅ PostgreSQL connected at ${result.rows[0].now}`);
        client.release();
        
        databaseManager = new DatabaseManager(db);
        await databaseManager.initializeTables();
        
        return db;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        throw error;
    }
}

// Initialize bot
async function initializeBot() {
    try {
        // Initialize database
        const db = await initializeDatabase();
        
        // Initialize XP manager
        xpManager = new XPManager(client, db);
        await xpManager.initialize();
        
        // Load commands
        client.commands = new Collection();
        await loadCommands(client);
        
        // Register slash commands
        if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
            await registerSlashCommands(process.env.CLIENT_ID, process.env.DISCORD_TOKEN);
        }
        
        console.log('✅ Bot initialization complete');
        
    } catch (error) {
        console.error('❌ Bot initialization failed:', error);
        process.exit(1);
    }
}

// Bot ready event
client.once('ready', async () => {
    console.log(`🏴‍☠️ One Piece XP Bot is ready!`);
    console.log(`⚓ Logged in as ${client.user.tag}`);
    console.log(`🏴‍☠️ Serving ${client.guilds.cache.size} server(s)`);
    console.log('🎯 All systems operational!');
});

// Message event
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Handle XP for messages
    if (xpManager) {
        await xpManager.handleMessageXP(message);
    }
    
    // Legacy ping command for testing
    if (message.content === '!ping') {
        const ping = Date.now() - message.createdTimestamp;
        await message.reply(`🏴‍☠️ **Pong!** \n📡 Bot Latency: \`${ping}ms\`\n💓 API Latency: \`${Math.round(client.ws.ping)}ms\``);
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

// Slash command handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, { xpManager, databaseManager });
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
                    await leaderboardCommand.execute(mockInteraction, { xpManager, databaseManager });
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
        
        if (databaseManager) {
            await databaseManager.cleanup();
        }
        
        client.destroy();
        console.log('👋 Bot shutdown complete!');
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
    }
    
    process.exit(0);
}

// Start the bot
async function startBot() {
    console.log('🚀 Starting One Piece XP Bot...');
    
    await initializeBot();
    await client.login(process.env.DISCORD_TOKEN);
}

// Export for other modules
module.exports = { client, databaseManager, xpManager };

// Start the bot
startBot().catch(console.error);
