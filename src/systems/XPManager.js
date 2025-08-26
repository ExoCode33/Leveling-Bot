const DatabaseManager = require('./DatabaseManager');
const BountyCalculator = require('../utils/BountyCalculator');
const LevelCalculator = require('../utils/LevelCalculator');
const DailyCapManager = require('./DailyCapManager');
const LevelUpHandler = require('./LevelUpHandler');
const XPLogger = require('../utils/XPLogger');

/**
 * XPManager - Main XP tracking and management system
 */
class XPManager {
    constructor(client, db) {
        this.client = client;
        this.db = db;
        this.cooldowns = new Map();
        
        // Initialize sub-systems with proper initialization
        this.dbManager = new DatabaseManager(db);
        this.bountyCalculator = new BountyCalculator();
        this.levelCalculator = new LevelCalculator();
        this.dailyCapManager = new DailyCapManager(db);
        this.levelUpHandler = new LevelUpHandler(client, db);
        this.xpLogger = new XPLogger(client);
    }

    /**
     * Initialize the XP manager
     */
    async initialize() {
        try {
            console.log('⚡ Initializing XP Manager...');
            
            // Initialize daily cap manager
            await this.dailyCapManager.initialize();
            
            // Start voice XP processing interval
            this.startVoiceXPProcessing();
            
            // Start daily reset schedule
            this.scheduleDailyReset();
            
            console.log('✅ XP Manager initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing XP Manager:', error);
            throw error;
        }
    }

    /**
     * Handle message XP
     */
    async handleMessageXP(message) {
        try {
            const userId = message.author.id;
            const guildId = message.guild.id;
            const cooldownKey = `${guildId}:${userId}:message`;
            const cooldownMs = parseInt(process.env.MESSAGE_COOLDOWN) || 60000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Get member for XP award
            const member = message.member;
            if (!member) return;

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId, member);
            if (!canGainXP.allowed) {
                return;
            }

            // Calculate XP
            const minXP = parseInt(process.env.MESSAGE_XP_MIN) || 75;
            const maxXP = parseInt(process.env.MESSAGE_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            const finalXP = Math.round(baseXP * tierMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'message', message.author, member);
            
            // Set cooldown
            this.setCooldown(cooldownKey);

        } catch (error) {
            console.error('Error handling message XP:', error);
        }
    }

    /**
     * Handle reaction XP
     */
    async handleReactionXP(reaction, user) {
        try {
            const userId = user.id;
            const guildId = reaction.message.guild.id;
            const cooldownKey = `${guildId}:${userId}:reaction`;
            const cooldownMs = parseInt(process.env.REACTION_COOLDOWN) || 300000;

            // Check cooldown
            if (this.isOnCooldown(cooldownKey, cooldownMs)) {
                return;
            }

            // Get member
            const guild = this.client.guilds.cache.get(guildId);
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;

            // Check daily cap
            const canGainXP = await this.dailyCapManager.canGainXP(userId, guildId, member);
            if (!canGainXP.allowed) {
                return;
            }

            // Calculate XP
            const minXP = parseInt(process.env.REACTION_XP_MIN) || 75;
            const maxXP = parseInt(process.env.REACTION_XP_MAX) || 100;
            const baseXP = Math.floor(Math.random() * (maxXP - minXP + 1)) + minXP;
            
            // Apply tier multiplier
            const tierMultiplier = await this.getTierMultiplier(member);
            const finalXP = Math.round(baseXP * tierMultiplier);

            // Award XP
            await this.awardXP(userId, guildId, finalXP, 'reaction', user, member);
            
            // Set
