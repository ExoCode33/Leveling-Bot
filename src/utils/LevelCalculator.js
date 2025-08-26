/**
 * LevelCalculator - Handles level calculations based on XP
 */
class LevelCalculator {
    constructor() {
        this.baseXP = parseInt(process.env.FORMULA_BASE_XP) || 500;
        this.multiplier = parseFloat(process.env.FORMULA_MULTIPLIER) || 1.75;
        this.curve = process.env.FORMULA_CURVE || 'exponential';
        this.maxLevel = parseInt(process.env.MAX_LEVEL) || 50;
        this.earlyLevelPenalty = parseFloat(process.env.EARLY_LEVEL_PENALTY) || 1.8;
        this.earlyLevelThreshold = parseInt(process.env.EARLY_LEVEL_THRESHOLD) || 10;
    }

    /**
     * Calculate level from total XP
     */
    calculateLevel(totalXP) {
        if (totalXP <= 0) return 0;

        for (let level = 1; level <= this.maxLevel; level++) {
            const requiredXP = this.getXPForLevel(level);
            
            if (totalXP < requiredXP) {
                return level - 1;
            }
        }

        return this.maxLevel;
    }

    /**
     * Get XP required to reach a specific level
     */
    getXPForLevel(level) {
        if (level === 0) return 0;

        let requiredXP;
        
        // Apply early level penalty for levels below threshold
        let effectiveMultiplier = this.multiplier;
        if (level <= this.earlyLevelThreshold) {
            effectiveMultiplier = this.multiplier * this.earlyLevelPenalty;
        }

        switch (this.curve) {
            case 'exponential':
                requiredXP = Math.floor(this.baseXP * Math.pow(level, effectiveMultiplier));
                break;
                
            case 'linear':
                requiredXP = Math.floor(this.baseXP * level * effectiveMultiplier);
                break;
                
            case 'logarithmic':
                requiredXP = Math.floor(this.baseXP * Math.log(level + 1) * effectiveMultiplier * 2);
                break;
                
            default:
                requiredXP = Math.floor(this.baseXP * Math.pow(level, effectiveMultiplier));
                break;
        }

        return requiredXP;
    }

    /**
     * Get XP needed to reach next level
     */
    getXPToNextLevel(currentXP) {
        const currentLevel = this.calculateLevel(currentXP);
        
        if (currentLevel >= this.maxLevel) {
            return 0; // Already at max level
        }
        
        const nextLevelXP = this.getXPForLevel(currentLevel + 1);
        return nextLevelXP - currentXP;
    }

    /**
     * Get XP progress within current level
     */
    getLevelProgress(currentXP) {
        const currentLevel = this.calculateLevel(currentXP);
        
        if (currentLevel >= this.maxLevel) {
            return {
                currentLevel: this.maxLevel,
                currentLevelXP: this.getXPForLevel(this.maxLevel),
                nextLevelXP: this.getXPForLevel(this.maxLevel),
                progressXP: 0,
                totalLevelXP: 0,
                percentage: 100
            };
        }
        
        const currentLevelXP = this.getXPForLevel(currentLevel);
        const nextLevelXP = this.getXPForLevel(currentLevel + 1);
        const progressXP = currentXP - currentLevelXP;
        const totalLevelXP = nextLevelXP - currentLevelXP;
        const percentage = Math.max(0, Math.min(100, Math.round((progressXP / totalLevelXP) * 100)));
        
        return {
            currentLevel,
            currentLevelXP,
            nextLevelXP,
            progressXP,
            totalLevelXP,
            percentage,
            xpToNext: nextLevelXP - currentXP
        };
    }

    /**
     * Get level range data
     */
    getLevelRange(startLevel, endLevel) {
        const range = [];
        
        for (let level = startLevel; level <= Math.min(endLevel, this.maxLevel); level++) {
            range.push({
                level: level,
                requiredXP: this.getXPForLevel(level),
                isEarlyLevel: level <= this.earlyLevelThreshold,
                penaltyApplied: level <= this.earlyLevelThreshold ? this.earlyLevelPenalty : 1.0
            });
        }
        
        return range;
    }

    /**
     * Simulate XP gain and level progression
     */
    simulateXPGain(currentXP, xpGain) {
        const oldLevel = this.calculateLevel(currentXP);
        const newXP = currentXP + xpGain;
        const newLevel = this.calculateLevel(newXP);
        const levelsGained = newLevel - oldLevel;
        
        const oldProgress = this.getLevelProgress(currentXP);
        const newProgress = this.getLevelProgress(newXP);
        
        return {
            oldLevel,
            newLevel,
            levelsGained,
            oldXP: currentXP,
            newXP: newXP,
            xpGained: xpGain,
            oldProgress,
            newProgress,
            leveledUp: levelsGained > 0
        };
    }

    /**
     * Get formula information
     */
    getFormulaInfo() {
        return {
            baseXP: this.baseXP,
            multiplier: this.multiplier,
            curve: this.curve,
            maxLevel: this.maxLevel,
            earlyLevelPenalty: this.earlyLevelPenalty,
            earlyLevelThreshold: this.earlyLevelThreshold
        };
    }

    /**
     * Calculate XP needed for level range
     */
    getXPRangeTotal(startLevel, endLevel) {
        let totalXP = 0;
        
        for (let level = startLevel; level <= Math.min(endLevel, this.maxLevel); level++) {
            totalXP += this.getXPForLevel(level);
        }
        
        return totalXP;
    }

    /**
     * Get level statistics
     */
    getLevelStats() {
        const maxLevelXP = this.getXPForLevel(this.maxLevel);
        const earlyLevelXP = this.getXPForLevel(this.earlyLevelThreshold);
        
        return {
            maxLevel: this.maxLevel,
            maxLevelXP: maxLevelXP,
            earlyLevelThreshold: this.earlyLevelThreshold,
            earlyLevelXP: earlyLevelXP,
            earlyLevelPenalty: this.earlyLevelPenalty,
            curve: this.curve,
            baseXP: this.baseXP,
            multiplier: this.multiplier,
            averageXPPerLevel: Math.round(maxLevelXP / this.maxLevel)
        };
    }

    /**
     * Find levels within XP range
     */
    getLevelsInXPRange(minXP, maxXP) {
        const levels = [];
        
        for (let level = 0; level <= this.maxLevel; level++) {
            const requiredXP = this.getXPForLevel(level);
            
            if (requiredXP >= minXP && requiredXP <= maxXP) {
                levels.push({
                    level: level,
                    requiredXP: requiredXP
                });
            }
        }
        
        return levels;
    }

    /**
     * Validate level calculation setup
     */
    validateSetup() {
        const issues = [];
        
        if (this.baseXP <= 0) {
            issues.push('Base XP must be greater than 0');
        }
        
        if (this.multiplier <= 0) {
            issues.push('Multiplier must be greater than 0');
        }
        
        if (this.maxLevel <= 0) {
            issues.push('Max level must be greater than 0');
        }
        
        if (this.earlyLevelThreshold > this.maxLevel) {
            issues.push('Early level threshold cannot exceed max level');
        }
        
        if (!['exponential', 'linear', 'logarithmic'].includes(this.curve)) {
            issues.push('Invalid curve type. Must be exponential, linear, or logarithmic');
        }
        
        // Test calculation consistency
        try {
            const testXP = this.getXPForLevel(10);
            const testLevel = this.calculateLevel(testXP);
            
            if (testLevel !== 10) {
                issues.push('Level calculation inconsistency detected');
            }
        } catch (error) {
            issues.push(`Calculation error: ${error.message}`);
        }
        
        return {
            valid: issues.length === 0,
            issues: issues
        };
    }

    /**
     * Create progress bar visualization
     */
    createProgressBar(currentXP, length = 20) {
        const progress = this.getLevelProgress(currentXP);
        
        if (progress.currentLevel >= this.maxLevel) {
            return '█'.repeat(length) + ' MAX LEVEL';
        }
        
        const filled = Math.round((progress.percentage / 100) * length);
        const empty = length - filled;
        
        const filledChar = '█';
        const emptyChar = '░';
        
        const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
        
        return `${bar} ${progress.percentage}% (${progress.progressXP.toLocaleString()}/${progress.totalLevelXP.toLocaleString()} XP)`;
    }
}

module.exports = LevelCalculator;
