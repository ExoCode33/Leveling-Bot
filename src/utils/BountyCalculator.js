/**
 * BountyCalculator - Handles bounty calculations for different levels
 */
class BountyCalculator {
    constructor() {
        // Complete bounty ladder for levels 0-50
        this.BOUNTY_LADDER = {
            0: 0,
            1: 1000000,      // 1 million
            2: 3000000,      // 3 million
            3: 5000000,      // 5 million
            4: 8000000,      // 8 million
            5: 30000000,     // 30 million
            6: 35000000,     // 35 million
            7: 42000000,     // 42 million
            8: 50000000,     // 50 million
            9: 65000000,     // 65 million
            10: 81000000,    // 81 million
            11: 90000000,    // 90 million
            12: 100000000,   // 100 million
            13: 108000000,   // 108 million
            14: 115000000,   // 115 million
            15: 120000000,   // 120 million
            16: 135000000,   // 135 million
            17: 150000000,   // 150 million
            18: 170000000,   // 170 million
            19: 185000000,   // 185 million
            20: 200000000,   // 200 million
            21: 220000000,   // 220 million
            22: 240000000,   // 240 million
            23: 260000000,   // 260 million
            24: 280000000,   // 280 million
            25: 320000000,   // 320 million
            26: 350000000,   // 350 million
            27: 380000000,   // 380 million
            28: 420000000,   // 420 million
            29: 460000000,   // 460 million
            30: 500000000,   // 500 million
            31: 550000000,   // 550 million
            32: 600000000,   // 600 million
            33: 660000000,   // 660 million
            34: 720000000,   // 720 million
            35: 860000000,   // 860 million
            36: 900000000,   // 900 million
            37: 950000000,   // 950 million
            38: 1000000000,  // 1 billion
            39: 1030000000,  // 1.03 billion
            40: 1057000000,  // 1.057 billion
            41: 1100000000,  // 1.1 billion
            42: 1200000000,  // 1.2 billion
            43: 1300000000,  // 1.3 billion
            44: 1400000000,  // 1.4 billion
            45: 1500000000,  // 1.5 billion
            46: 1800000000,  // 1.8 billion
            47: 2100000000,  // 2.1 billion
            48: 2500000000,  // 2.5 billion
            49: 2800000000,  // 2.8 billion
            50: 3000000000   // 3 billion
        };

        this.PIRATE_KING_BOUNTY = 4600000000; // 4.6 billion (Gol D. Roger's bounty)

        // Threat level messages for milestone levels
        this.THREAT_LEVEL_MESSAGES = {
            0: "New individual detected. No criminal activity reported. Continue monitoring.",
            5: "Criminal activity confirmed in East Blue region. Initial bounty authorized.",
            10: "Multiple incidents involving Marine personnel. Elevated threat status.",
            15: "Subject has crossed into Grand Line territory. Enhanced surveillance required.",
            20: "Dangerous individual. Multiple Marine casualties reported. Caution advised.",
            25: "HIGH PRIORITY TARGET: Classified as extremely dangerous. Deploy specialized units.",
            30: "ADVANCED COMBATANT: Confirmed use of advanced fighting techniques. Vice Admiral response.",
            35: "TERRITORIAL THREAT: Capable of commanding large operations. Fleet mobilization recommended.",
            40: "ELITE LEVEL THREAT: Extreme danger to Marine operations. Admiral consultation required.",
            45: "EXTRAORDINARY ABILITIES: Unprecedented power levels detected. Maximum security protocols.",
            50: "EMPEROR CLASS THREAT: Controls vast territories. Considered one of the most dangerous pirates."
        };
    }

    /**
     * Get bounty amount for a specific level
     */
    getBountyForLevel(level, isPirateKing = false) {
        // Special bounty for Pirate King
        if (isPirateKing) {
            return this.PIRATE_KING_BOUNTY;
        }
        
        // Clamp level to maximum
        if (level > 50) level = 50;
        if (level < 0) level = 0;
        
        // Return exact bounty if it exists
        if (this.BOUNTY_LADDER[level] !== undefined) {
            return this.BOUNTY_LADDER[level];
        }
        
        // For any missing levels, interpolate between known values
        const lowerLevel = Math.floor(level);
        const upperLevel = Math.ceil(level);
        
        if (lowerLevel === upperLevel) {
            return this.BOUNTY_LADDER[lowerLevel] || 0;
        }
        
        const lowerBounty = this.BOUNTY_LADDER[lowerLevel] || 0;
        const upperBounty = this.BOUNTY_LADDER[upperLevel] || lowerBounty;
        const ratio = level - lowerLevel;
        
        return Math.floor(lowerBounty + (upperBounty - lowerBounty) * ratio);
    }

    /**
     * Get threat level message for a specific level
     */
    getThreatLevelMessage(level) {
        // Check for exact milestone matches
        if (this.THREAT_LEVEL_MESSAGES[level]) {
            return this.THREAT_LEVEL_MESSAGES[level];
        }
        
        // For non-milestone levels, return default message
        return "Bounty increased. Threat level rising.";
    }

    /**
     * Get threat level name for a specific level
     */
    getThreatLevelName(level, isPirateKing = false) {
        if (isPirateKing) return "PIRATE KING";
        if (level >= 50) return "EMPEROR CLASS";
        if (level >= 45) return "EXTRAORDINARY";
        if (level >= 40) return "ELITE LEVEL";
        if (level >= 35) return "TERRITORIAL";
        if (level >= 30) return "ADVANCED COMBATANT";
        if (level >= 25) return "HIGH PRIORITY";
        if (level >= 20) return "DANGEROUS";
        if (level >= 15) return "GRAND LINE";
        if (level >= 10) return "ELEVATED";
        if (level >= 5) return "CONFIRMED CRIMINAL";
        return "MONITORING";
    }

    /**
     * Get bounty increase between two levels
     */
    getBountyIncrease(oldLevel, newLevel, isPirateKing = false) {
        const oldBounty = this.getBountyForLevel(oldLevel, isPirateKing);
        const newBounty = this.getBountyForLevel(newLevel, isPirateKing);
        return newBounty - oldBounty;
    }

    /**
     * Get all bounty data for a level range
     */
    getBountyRange(startLevel, endLevel) {
        const range = [];
        
        for (let level = startLevel; level <= endLevel; level++) {
            range.push({
                level: level,
                bounty: this.getBountyForLevel(level),
                threatLevel: this.getThreatLevelName(level),
                message: this.getThreatLevelMessage(level)
            });
        }
        
        return range;
    }

    /**
     * Find level for a specific bounty amount (reverse lookup)
     */
    getLevelForBounty(targetBounty) {
        let closestLevel = 0;
        let closestDifference = Math.abs(targetBounty - this.getBountyForLevel(0));
        
        for (let level = 0; level <= 50; level++) {
            const bounty = this.getBountyForLevel(level);
            const difference = Math.abs(targetBounty - bounty);
            
            if (difference < closestDifference) {
                closestDifference = difference;
                closestLevel = level;
            }
        }
        
        return closestLevel;
    }

    /**
     * Format bounty amount for display
     */
    formatBounty(amount) {
        if (amount >= 1000000000) {
            return `฿${(amount / 1000000000).toFixed(1)}B`;
        } else if (amount >= 1000000) {
            return `฿${(amount / 1000000).toFixed(1)}M`;
        } else if (amount >= 1000) {
            return `฿${(amount / 1000).toFixed(1)}K`;
        } else {
            return `฿${amount}`;
        }
    }

    /**
     * Get milestone levels (levels with special threat messages)
     */
    getMilestoneLevels() {
        return Object.keys(this.THREAT_LEVEL_MESSAGES).map(level => parseInt(level));
    }

    /**
     * Check if level is a milestone
     */
    isMilestone(level) {
        return this.THREAT_LEVEL_MESSAGES.hasOwnProperty(level);
    }

    /**
     * Get next milestone level
     */
    getNextMilestone(currentLevel) {
        const milestones = this.getMilestoneLevels();
        
        for (const milestone of milestones) {
            if (milestone > currentLevel) {
                return milestone;
            }
        }
        
        return null; // No more milestones
    }

    /**
     * Get bounty statistics
     */
    getBountyStats() {
        const bounties = Object.values(this.BOUNTY_LADDER);
        
        return {
            minBounty: Math.min(...bounties),
            maxBounty: Math.max(...bounties),
            averageBounty: Math.round(bounties.reduce((sum, bounty) => sum + bounty, 0) / bounties.length),
            totalLevels: Object.keys(this.BOUNTY_LADDER).length,
            pirateKingBounty: this.PIRATE_KING_BOUNTY,
            milestones: this.getMilestoneLevels().length
        };
    }
}

module.exports = BountyCalculator;
