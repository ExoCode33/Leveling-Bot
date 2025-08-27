const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const BountyCalculator = require('./BountyCalculator');

/**
 * CanvasGenerator - Handles all canvas/image generation for wanted posters
 * FIXED: Proper caching integration and avatar handling
 */
class CanvasGenerator {
    constructor(cacheManager = null) {
        this.bountyCalculator = new BountyCalculator();
        this.cacheManager = cacheManager;
        this.registerFonts();
    }

    /**
     * Register custom fonts
     */
    registerFonts() {
        try {
            const fontsPath = path.join(__dirname, '../../assets/fonts');
            
            registerFont(path.join(fontsPath, 'captkd.ttf'), { family: 'CaptainKiddNF' });
            registerFont(path.join(fontsPath, 'Cinzel-Bold.otf'), { family: 'Cinzel' });
            registerFont(path.join(fontsPath, 'Times New Normal Regular.ttf'), { family: 'TimesNewNormal' });
            
            console.log('[CANVAS] ✅ Successfully registered custom fonts');
        } catch (error) {
            console.error('[CANVAS] ❌ Failed to register custom fonts:', error.message);
            console.log('[CANVAS] Falling back to system fonts');
        }
    }

    /**
     * Create wanted poster canvas with caching
     */
    async createWantedPoster(userData, guild) {
        const width = 600;
        const height = 900;

        try {
            // Check cache first
            const cacheKey = this.getPosterCacheKey(userData);
            if (this.cacheManager && cacheKey) {
                console.log(`[CANVAS] 🔍 Checking cache for poster: ${cacheKey}`);
                const cachedBuffer = await this.cacheManager.getCachedPoster(
                    userData.userId, 
                    userData.level, 
                    userData.bounty
                );
                
                if (cachedBuffer) {
                    console.log(`[CANVAS] ✅ Using cached poster for user ${userData.userId}`);
                    // Convert buffer back to canvas for return
                    const cachedCanvas = createCanvas(width, height);
                    const cachedCtx = cachedCanvas.getContext('2d');
                    const img = await loadImage(cachedBuffer);
                    cachedCtx.drawImage(img, 0, 0);
                    return cachedCanvas;
                }
            }

            console.log(`[CANVAS] 🎨 Generating new poster for user ${userData.userId} (Level ${userData.level})`);
            
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // Load and draw background
            await this.drawBackground(ctx, width, height);
            
            // Draw borders
            this.drawBorders(ctx, width, height);
            
            // Draw "WANTED" title
            this.drawWantedTitle(ctx, width, height);
            
            // Draw photo frame and avatar with caching
            await this.drawPhotoSection(ctx, userData, guild, width, height);
            
            // Draw "DEAD OR ALIVE"
            this.drawDeadOrAlive(ctx, width, height);
            
            // Draw name
            this.drawName(ctx, userData, width, height);
            
            // Draw bounty
            await this.drawBounty(ctx, userData, width, height);
            
            // Draw One Piece logo
            await this.drawOnePieceLogo(ctx, width, height);
            
            // Draw "MARINE" text
            this.drawMarineText(ctx, width, height);

            // Cache the completed poster
            if (this.cacheManager && cacheKey) {
                try {
                    const buffer = canvas.toBuffer();
                    await this.cacheManager.cacheWantedPoster(
                        userData.userId, 
                        userData.level, 
                        userData.bounty, 
                        buffer
                    );
                    console.log(`[CANVAS] ✅ Cached new poster for user ${userData.userId}`);
                } catch (cacheError) {
                    console.error('[CANVAS] ⚠️ Failed to cache poster:', cacheError);
                }
            }
            
            return canvas;
            
        } catch (error) {
            console.error('[CANVAS] Error creating wanted poster:', error);
            
            // Return simple fallback canvas
            return this.createFallbackCanvas(userData, width, height);
        }
    }

    /**
     * Generate cache key for poster
     */
    getPosterCacheKey(userData) {
        if (!userData.userId || userData.level === undefined || !userData.bounty) {
            return null;
        }
        return `${userData.userId}_${userData.level}_${userData.bounty}`;
    }

    /**
     * Draw background texture
     */
    async drawBackground(ctx, width, height) {
        try {
            const texturePath = path.join(__dirname, '../../assets/scroll_texture.jpg');
            const texture = await loadImage(texturePath);
            ctx.drawImage(texture, 0, 0, width, height);
            console.log('[CANVAS] ✅ Loaded scroll texture background');
        } catch (error) {
            console.log('[CANVAS] Scroll texture not found, using fallback color');
            ctx.fillStyle = '#f5e6c5';
            ctx.fillRect(0, 0, width, height);
        }
    }

    /**
     * Draw poster borders
     */
    drawBorders(ctx, width, height) {
        // Outer border
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, width, height);
        
        // Middle border
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, width - 20, height - 20);
        
        // Inner border
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeRect(18, 18, width - 36, height - 36);
    }

    /**
     * Draw "WANTED" title
     */
    drawWantedTitle(ctx, width, height) {
        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '81px CaptainKiddNF, Arial, sans-serif';
        
        const wantedY = height * (1 - 92/100);
        const wantedX = (50/100) * width;
        
        ctx.fillText('WANTED', wantedX, wantedY);
    }

    /**
     * Draw photo section with avatar and caching
     */
    async drawPhotoSection(ctx, userData, guild, width, height) {
        const photoSize = (95/100) * 400;
        const photoX = ((50/100) * width) - (photoSize/2);
        const photoY = height * (1 - 65/100) - (photoSize/2);
        
        // Draw photo frame
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeRect(photoX, photoY, photoSize, photoSize);

        // Define avatar area
        const avatarArea = { 
            x: photoX + 3, 
            y: photoY + 3, 
            width: photoSize - 6, 
            height: photoSize - 6 
        };

        // Try to get member and load avatar
        let member = null;
        let avatarBuffer = null;
        
        try {
            if (guild && userData.userId) {
                member = await guild.members.fetch(userData.userId);
                
                if (member) {
                    const avatarURL = member.user.displayAvatarURL({ 
                        extension: 'png', 
                        size: 512, 
                        forceStatic: true 
                    });
                    
                    // Extract avatar hash for caching
                    const avatarHash = this.extractAvatarHash(avatarURL);
                    
                    // Check cache first
                    if (this.cacheManager && avatarHash) {
                        console.log(`[CANVAS] 🔍 Checking avatar cache for user ${userData.userId}`);
                        avatarBuffer = await this.cacheManager.getCachedAvatar(userData.userId, avatarHash);
                    }
                    
                    // Load avatar if not cached
                    if (!avatarBuffer) {
                        console.log(`[CANVAS] 📥 Loading avatar from URL for user ${userData.userId}`);
                        const avatar = await loadImage(avatarURL);
                        
                        // Convert to buffer for caching
                        const tempCanvas = createCanvas(512, 512);
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.drawImage(avatar, 0, 0, 512, 512);
                        avatarBuffer = tempCanvas.toBuffer();
                        
                        // Cache the avatar
                        if (this.cacheManager && avatarHash) {
                            await this.cacheManager.cacheUserAvatar(userData.userId, avatarHash, avatarBuffer);
                        }
                    }
                }
            }
        } catch (error) {
            console.log(`[CANVAS] ⚠️ Could not fetch/load avatar for user ${userData.userId}:`, error.message);
        }
        
        // Draw avatar if available
        if (avatarBuffer) {
            try {
                const avatar = await loadImage(avatarBuffer);
                
                // Create clipping mask for avatar
                ctx.save();
                ctx.beginPath();
                ctx.rect(avatarArea.x, avatarArea.y, avatarArea.width, avatarArea.height);
                ctx.clip();
                
                // Apply subtle weathering effect
                ctx.filter = 'contrast(0.95) sepia(0.05)';
                ctx.drawImage(avatar, avatarArea.x, avatarArea.y, avatarArea.width, avatarArea.height);
                ctx.filter = 'none';
                
                ctx.restore();
                
                console.log(`[CANVAS] ✅ Successfully drew avatar for user ${userData.userId}`);
            } catch (drawError) {
                console.log(`[CANVAS] ⚠️ Could not draw cached avatar for user ${userData.userId}:`, drawError.message);
            }
        } else {
            console.log(`[CANVAS] ℹ️ No avatar available for user ${userData.userId}, showing background`);
        }
    }

    /**
     * Extract avatar hash from Discord avatar URL
     */
    extractAvatarHash(avatarURL) {
        try {
            const match = avatarURL.match(/avatars\/\d+\/([a-f0-9]+)\.(png|jpg|gif|webp)/);
            return match ? match[1] : null;
        } catch (error) {
            console.log('[CANVAS] Could not extract avatar hash');
            return null;
        }
    }

    /**
     * Draw "DEAD OR ALIVE" text
     */
    drawDeadOrAlive(ctx, width, height) {
        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '57px CaptainKiddNF, Arial, sans-serif';
        
        const deadOrAliveY = height * (1 - 39/100);
        const deadOrAliveX = (50/100) * width;
        
        ctx.fillText('DEAD OR ALIVE', deadOrAliveX, deadOrAliveY);
    }

    /**
     * Draw character name
     */
    drawName(ctx, userData, width, height) {
        ctx.fillStyle = '#111';
        ctx.font = '69px CaptainKiddNF, Arial, sans-serif';
        
        let displayName = 'UNKNOWN PIRATE';
        
        if (userData.member) {
            displayName = userData.member.displayName
                .replace(/[^\w\s-]/g, '')
                .toUpperCase()
                .substring(0, 16);
        } else if (userData.userId) {
            displayName = `PIRATE ${userData.userId.slice(-4)}`;
        }
        
        // Check if name is too long and adjust font size
        ctx.textAlign = 'center';
        let nameWidth = ctx.measureText(displayName).width;
        
        if (nameWidth > width - 60) {
            ctx.font = '55px CaptainKiddNF, Arial, sans-serif';
        }
        
        const nameY = height * (1 - 30/100);
        const nameX = (50/100) * width;
        
        ctx.fillText(displayName, nameX, nameY);
    }

    /**
     * Draw bounty amount with berry symbol
     */
    async drawBounty(ctx, userData, width, height) {
        const berryBountyGap = 5;
        
        // Get bounty amount
        const isPirateKingData = userData.isPirateKing || false;
        const bountyAmount = this.bountyCalculator.getBountyForLevel(userData.level, isPirateKingData);
        const bountyStr = bountyAmount.toLocaleString();
        
        console.log(`[CANVAS] Level ${userData.level}${isPirateKingData ? ' (PIRATE KING)' : ''} = Bounty ฿${bountyStr}`);
        
        // Set up bounty text
        ctx.font = '54px Cinzel, Georgia, serif';
        const bountyTextWidth = ctx.measureText(bountyStr).width;
        
        // Berry symbol size
        const berrySize = (32/100) * 150;
        
        // Calculate total width of bounty unit (berry + gap + text)
        const gapPixels = (berryBountyGap/100) * width;
        const totalBountyWidth = berrySize + gapPixels + bountyTextWidth;
        
        // Center the entire bounty unit horizontally
        const bountyUnitStartX = (width - totalBountyWidth) / 2;
        
        // Position berry symbol
        const berryX = bountyUnitStartX + (berrySize/2);
        const berryY = height * (1 - 22/100) - (berrySize/2);
        
        // Load and draw berry symbol
        let berryImg;
        try {
            const berryPath = path.join(__dirname, '../../assets/berry.png');
            berryImg = await loadImage(berryPath);
            console.log('[CANVAS] ✅ Loaded berry symbol');
        } catch (error) {
            console.log('[CANVAS] Berry image not found, creating fallback symbol');
            // Create fallback berry symbol
            const berryCanvas = createCanvas(berrySize, berrySize);
            const berryCtx = berryCanvas.getContext('2d');
            berryCtx.fillStyle = '#111';
            berryCtx.font = `bold ${berrySize}px serif`;
            berryCtx.textAlign = 'center';
            berryCtx.textBaseline = 'middle';
            berryCtx.fillText('฿', berrySize/2, berrySize/2);
            berryImg = berryCanvas;
        }
        
        ctx.drawImage(berryImg, berryX - (berrySize/2), berryY, berrySize, berrySize);

        // Position and draw bounty numbers
        const bountyX = bountyUnitStartX + berrySize + gapPixels;
        const bountyY = height * (1 - 22/100);
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#111';
        ctx.fillText(bountyStr, bountyX, bountyY);
    }

    /**
     * Draw One Piece logo
     */
    async drawOnePieceLogo(ctx, width, height) {
        try {
            const logoPath = path.join(__dirname, '../../assets/one-piece-symbol.png');
            const logo = await loadImage(logoPath);
            
            const logoSize = (26/100) * 200;
            const logoX = ((50/100) * width) - (logoSize/2);
            const logoY = height * (1 - 4.5/100) - (logoSize/2);
            
            ctx.globalAlpha = 0.6;
            ctx.filter = 'sepia(0.2) brightness(0.9)';
            ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
            ctx.globalAlpha = 1.0;
            ctx.filter = 'none';
            
            console.log('[CANVAS] ✅ Drew One Piece logo');
        } catch (error) {
            console.log('[CANVAS] One Piece logo not found, skipping');
        }
    }

    /**
     * Draw "MARINE" text
     */
    drawMarineText(ctx, width, height) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.font = '24px TimesNewNormal, Times, serif';
        ctx.fillStyle = '#111';
        
        const marineText = 'M A R I N E';
        const marineX = (96/100) * width;
        const marineY = height * (1 - 2/100);
        
        ctx.fillText(marineText, marineX, marineY);
    }

    /**
     * Create fallback canvas if main generation fails
     */
    createFallbackCanvas(userData, width, height) {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Simple fallback design
        ctx.fillStyle = '#f5e6c5';
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.strokeRect(5, 5, width - 10, height - 10);
        
        ctx.fillStyle = '#000';
        ctx.font = 'bold 60px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillText('WANTED', width / 2, height * 0.2);
        ctx.fillText('DEAD OR ALIVE', width / 2, height * 0.8);
        
        // Draw bounty
        const bounty = this.bountyCalculator.getBountyForLevel(userData.level || 0);
        ctx.font = 'bold 40px Arial';
        ctx.fillText(`฿${bounty.toLocaleString()}`, width / 2, height * 0.9);
        
        console.log('[CANVAS] ✅ Created fallback canvas');
        return canvas;
    }

    /**
     * Validate assets exist
     */
    async validateAssets() {
        const assets = [
            { path: '../../assets/scroll_texture.jpg', name: 'Scroll Texture' },
            { path: '../../assets/berry.png', name: 'Berry Symbol' },
            { path: '../../assets/one-piece-symbol.png', name: 'One Piece Logo' },
            { path: '../../assets/fonts/captkd.ttf', name: 'Captain Kidd Font' },
            { path: '../../assets/fonts/Cinzel-Bold.otf', name: 'Cinzel Font' },
            { path: '../../assets/fonts/Times New Normal Regular.ttf', name: 'Times New Normal Font' }
        ];

        const results = [];

        for (const asset of assets) {
            try {
                const fullPath = path.join(__dirname, asset.path);
                
                if (asset.path.includes('.ttf') || asset.path.includes('.otf')) {
                    // For fonts, just check if file exists (we can't load them here)
                    const fs = require('fs');
                    fs.accessSync(fullPath);
                    results.push({ name: asset.name, status: 'Available', path: asset.path });
                } else {
                    // For images, try to load them
                    await loadImage(fullPath);
                    results.push({ name: asset.name, status: 'Available', path: asset.path });
                }
            } catch (error) {
                results.push({ name: asset.name, status: 'Missing', path: asset.path, error: error.message });
            }
        }

        return results;
    }
}

module.exports = CanvasGenerator;
