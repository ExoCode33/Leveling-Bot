const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Load all commands from the commands directory
 */
async function loadCommands(client) {
    try {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            console.warn('⚠️ Commands directory not found, creating it...');
            fs.mkdirSync(commandsPath, { recursive: true });
            return;
        }
        
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        
        let loadedCount = 0;
        
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            
            try {
                // Clear require cache to allow hot reloading
                delete require.cache[require.resolve(filePath)];
                
                const command = require(filePath);
                
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    console.log(`📋 Loaded command: ${command.data.name}`);
                    loadedCount++;
                } else {
                    console.warn(`⚠️ Command at ${filePath} is missing required "data" or "execute" property`);
                }
            } catch (error) {
                console.error(`❌ Error loading command ${file}:`, error.message);
            }
        }
        
        console.log(`✅ Successfully loaded ${loadedCount} commands`);
        
    } catch (error) {
        console.error('❌ Error loading commands:', error);
    }
}

/**
 * Register slash commands with Discord
 */
async function registerSlashCommands(clientId, token) {
    try {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            console.warn('⚠️ Commands directory not found, skipping slash command registration');
            return;
        }
        
        const commands = [];
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            
            try {
                const command = require(filePath);
                
                if ('data' in command && 'execute' in command) {
                    commands.push(command.data.toJSON());
                } else {
                    console.warn(`⚠️ Command at ${filePath} is missing required "data" or "execute" property`);
                }
            } catch (error) {
                console.warn(`⚠️ Could not load command ${file} for registration:`, error.message);
            }
        }

        if (commands.length === 0) {
            console.warn('⚠️ No valid commands found to register');
            return;
        }

        const rest = new REST().setToken(token);
        
        console.log(`🔄 Started refreshing ${commands.length} application (/) commands...`);
        
        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands`);
        
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
        
        if (error.code === 50001) {
            console.error('❌ Missing Access: Bot token may be invalid or bot not invited with applications.commands scope');
        } else if (error.code === 10002) {
            console.error('❌ Unknown Application: CLIENT_ID may be incorrect');
        }
    }
}

/**
 * Reload a specific command
 */
async function reloadCommand(client, commandName) {
    try {
        const commandsPath = path.join(__dirname, '../commands');
        const commandFile = path.join(commandsPath, `${commandName}.js`);
        
        if (!fs.existsSync(commandFile)) {
            return { success: false, error: 'Command file not found' };
        }
        
        // Clear require cache
        delete require.cache[require.resolve(commandFile)];
        
        // Load command
        const command = require(commandFile);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`🔄 Reloaded command: ${command.data.name}`);
            return { success: true };
        } else {
            return { success: false, error: 'Command missing required properties' };
        }
        
    } catch (error) {
        console.error(`❌ Error reloading command ${commandName}:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Get command information
 */
function getCommandInfo(client, commandName) {
    const command = client.commands.get(commandName);
    
    if (!command) {
        return null;
    }
    
    return {
        name: command.data.name,
        description: command.data.description,
        options: command.data.options || [],
        defaultMemberPermissions: command.data.default_member_permissions || null,
        dmPermission: command.data.dm_permission !== false
    };
}

/**
 * Get all command information
 */
function getAllCommandsInfo(client) {
    const commands = [];
    
    for (const [name, command] of client.commands) {
        commands.push({
            name: command.data.name,
            description: command.data.description,
            options: command.data.options?.length || 0,
            permissions: command.data.default_member_permissions || 'None',
            dmEnabled: command.data.dm_permission !== false
        });
    }
    
    return commands.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Validate command structure
 */
function validateCommand(command) {
    const errors = [];
    
    if (!command.data) {
        errors.push('Missing "data" property');
    } else {
        if (!command.data.name) {
            errors.push('Missing command name');
        }
        
        if (!command.data.description) {
            errors.push('Missing command description');
        }
        
        if (command.data.name && (command.data.name.length < 1 || command.data.name.length > 32)) {
            errors.push('Command name must be 1-32 characters');
        }
        
        if (command.data.description && (command.data.description.length < 1 || command.data.description.length > 100)) {
            errors.push('Command description must be 1-100 characters');
        }
    }
    
    if (!command.execute || typeof command.execute !== 'function') {
        errors.push('Missing or invalid "execute" function');
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Create command template
 */
function createCommandTemplate(name, description) {
    return `const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('${name}')
        .setDescription('${description}'),
        
    async execute(interaction, { xpManager, databaseManager }) {
        try {
            // Your command logic here
            await interaction.reply({
                content: 'Command executed successfully!',
                ephemeral: true
            });
            
        } catch (error) {
            console.error('Error executing ${name} command:', error);
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: '❌ An error occurred while executing this command.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '❌ An error occurred while executing this command.',
                    ephemeral: true
                });
            }
        }
    }
};`;
}

/**
 * Generate command file
 */
function generateCommandFile(name, description) {
    try {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
        }
        
        const fileName = `${name}.js`;
        const filePath = path.join(commandsPath, fileName);
        
        if (fs.existsSync(filePath)) {
            return { success: false, error: 'Command file already exists' };
        }
        
        const template = createCommandTemplate(name, description);
        fs.writeFileSync(filePath, template, 'utf8');
        
        return { success: true, filePath: filePath };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    loadCommands,
    registerSlashCommands,
    reloadCommand,
    getCommandInfo,
    getAllCommandsInfo,
    validateCommand,
    createCommandTemplate,
    generateCommandFile
};
