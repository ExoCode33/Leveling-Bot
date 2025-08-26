# 🏴‍☠️ One Piece XP Bot

A complete One Piece themed Discord XP tracking bot with beautiful wanted poster generation, daily caps, tier bonuses, and comprehensive Marine Intelligence styling.

## ✨ Features

### 🎯 **Core XP System**
- **Message XP**: Gain XP from chat activity
- **Voice XP**: Earn XP while in voice channels
- **Reaction XP**: Get XP from adding reactions
- **Daily Caps**: Prevent XP farming with daily limits
- **Tier Bonuses**: Increased daily caps for special roles
- **Level Roles**: Automatic role assignment based on level

### 🏴‍☠️ **One Piece Theme**
- **Wanted Posters**: Custom canvas-generated bounty posters
- **Marine Intelligence**: All embeds styled as Marine reports
- **Bounty System**: Levels correspond to One Piece bounties
- **Pirate King Support**: Special handling for excluded roles
- **Threat Levels**: Bounty-based threat classifications

### 🎨 **Visual Features**
- **Canvas Generation**: High-quality wanted posters with user avatars
- **Custom Fonts**: One Piece themed typography
- **Weathered Effects**: Authentic scroll/poster appearance
- **Berry Symbols**: Proper One Piece currency display
- **Dynamic Layouts**: Responsive poster generation

### 📊 **Admin Tools**
- **Complete Admin Suite**: Add/remove/set XP, reset users
- **Bot Statistics**: Comprehensive database insights
- **Database Maintenance**: Cleanup and optimization tools
- **Activity Logging**: Detailed XP activity tracking
- **Settings Management**: Easy server configuration

## 🚀 Setup Guide

### 1. **Prerequisites**
```bash
# Node.js 18+ required
node --version

# PostgreSQL database
# Canvas dependencies (for image generation)
```

### 2. **Installation**
```bash
# Clone the repository
git clone <your-repo-url>
cd one-piece-xp-bot

# Install dependencies
npm install

# Install canvas dependencies (OS-specific)
# Ubuntu/Debian:
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# macOS:
brew install pkg-config cairo pango libpng jpeg giflib librsvg

# Windows: Install windows-build-tools
npm install --global windows-build-tools
```

### 3. **Database Setup**
```sql
-- Create PostgreSQL database
CREATE DATABASE one_piece_xp_bot;

-- The bot will automatically create all required tables
```

### 4. **Environment Configuration**
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your values
nano .env
```

**Required Environment Variables:**
```env
# Bot Configuration (REQUIRED)
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_id_here
DATABASE_URL=postgresql://user:password@host:port/database

# Admin Configuration
ADMIN_USER_ID=your_discord_user_id_here

# XP Configuration (Optional - has defaults)
MESSAGE_XP_MIN=75
MESSAGE_XP_MAX=100
VOICE_XP_MIN=250
VOICE_XP_MAX=350
DAILY_XP_CAP=15000

# Level Roles (Optional)
LEVEL_5_ROLE=your_role_id_here
LEVEL_10_ROLE=your_role_id_here
# ... etc

# Tier Roles (Optional - for increased daily caps)
TIER_1_ROLE=role_id_here
TIER_1_XP_CAP=20000
# ... etc

# Special Roles (Optional)
LEADERBOARD_EXCLUDE_ROLE=pirate_king_role_id_here
```

### 5. **Discord Bot Setup**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token to your `.env` file
5. Copy the application ID to your `.env` file
6. **Invite bot with these permissions:**
   - `Send Messages`
   - `Use Slash Commands`
   - `Embed Links`
   - `Attach Files`
   - `Read Message History`
   - `Manage Roles` (for level roles)
   - `Connect` and `Speak` (for voice XP)

### 6. **Assets Setup (Optional)**
Create the assets folder for enhanced visuals:
```
assets/
├── fonts/
│   ├── captkd.ttf              # Captain Kidd font
│   ├── Cinzel-Bold.otf         # Cinzel font
│   └── Times New Normal Regular.ttf
├── berry.png                   # Berry symbol
├── one-piece-symbol.png        # One Piece logo
└── scroll_texture.jpg          # Background texture
```

*Note: Without assets, the bot will use fallback fonts and colors*

### 7. **Run the Bot**
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

## 📋 Commands

### 👤 **User Commands**
- `/level [@user]` - View wanted poster and stats
- `/leaderboard [type]` - Server leaderboard with posters

### ⚙️ **Admin Commands**
- `/admin` - Complete administration suite
  - Add/Remove/Set XP
  - View user stats
  - Bot statistics  
  - Database maintenance
  - Force daily reset
- `/settings` - Configure server XP settings

## 🎮 Usage Examples

### **Viewing a Wanted Poster**
```
/level @username
```
Generates a custom One Piece style wanted poster with:
- User's avatar as the bounty photo
- Current bounty amount
- Level and rank information
- Activity breakdown
- Progress to next level

### **Server Leaderboard**
```
/leaderboard type:Top 3 Bounties
```
Shows top pirates with full wanted posters and Marine Intelligence reports.

### **Admin Operations**
```
/admin action:Add XP to User user:@someone amount:1000 reason:Event reward
```

## 🔧 Configuration

### **XP Sources**
- **Messages**: 75-100 XP per message (1-minute cooldown)
- **Voice**: 250-350 XP per 5-minute interval (requires 2+ members)
- **Reactions**: 75-100 XP per reaction (5-minute cooldown)

### **Daily Caps**
- **Base Cap**: 15,000 XP per day
- **Tier Bonuses**: Up to 20,000 XP for special roles
- **Reset Time**: 7:35 PM EDT daily

### **Level System**
- **Max Level**: 50
- **Formula**: Exponential curve with early-level penalty
- **Bounties**: Based on One Piece bounty progression

## 🛠️ Advanced Configuration

### **Custom Level Roles**
Set role IDs in `.env` for automatic role assignment:
```env
LEVEL_5_ROLE=role_id_here
LEVEL_10_ROLE=role_id_here
LEVEL_15_ROLE=role_id_here
# ... etc
```

### **Tier System**
Create tier roles for increased daily XP caps:
```env
TIER_1_ROLE=quiz_tier_1_role_id
TIER_1_XP_CAP=20000
TIER_2_ROLE=quiz_tier_2_role_id  
TIER_2_XP_CAP=25000
# ... etc
```

### **Pirate King Role**
Set a special role to be excluded from normal leaderboards:
```env
LEADERBOARD_EXCLUDE_ROLE=pirate_king_role_id
```

### **Voice XP Configuration**
```env
VOICE_MIN_MEMBERS=2                    # Minimum members for XP
VOICE_ANTI_AFK=true                   # Reduce XP for muted/deafened
VOICE_MUTE_EXEMPT_ROLES=role_id_here  # Roles exempt from AFK penalty
VOICE_PROCESSING_INTERVAL=300000      # 5 minutes
```

## 📊 Database Schema

The bot automatically creates these tables:
- `user_levels` - Main XP and level data
- `daily_xp` - Daily XP tracking and caps
- `voice_sessions` - Active voice channel sessions
- `guild_settings` - Server-specific configuration

## 🔍 Troubleshooting

### **Common Issues**

**Canvas/Image Generation Fails:**
```bash
# Install canvas dependencies for your OS
# Ubuntu: sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
# macOS: brew install pkg-config cairo pango libpng jpeg giflib librsvg  
# Windows: npm install --global windows-build-tools
```

**Database Connection Issues:**
- Verify PostgreSQL is running
- Check DATABASE_URL format: `postgresql://user:password@host:port/database`
- Ensure database exists and user has proper permissions

**Slash Commands Not Appearing:**
- Verify CLIENT_ID is correct
- Check bot permissions in server
- Try `/` in a channel where bot has access

**Level Roles Not Working:**
- Verify role IDs are correct (right-click role → Copy ID)
- Check bot has "Manage Roles" permission
- Ensure bot's role is higher than the roles it's trying to assign

### **Debug Mode**
Set `DEBUG=true` in `.env` for detailed console logging.

## 📈 Performance

### **Optimization Tips**
- Use SSD storage for PostgreSQL
- Set up proper database indexes (auto-created)
- Monitor memory usage for canvas generation
- Use process manager like PM2 for production

### **Scaling**
- Daily XP cleanup runs automatically
- Database maintenance tools included
- Memory-efficient voice XP processing
- Optimized canvas generation

## 🎨 Customization

### **Bounty Values**
Edit `src/utils/BountyCalculator.js` to modify bounty amounts per level.

### **Canvas Styling**
Modify `src/utils/CanvasGenerator.js` for poster appearance changes.

### **XP Formulas**
Adjust level calculation in `src/utils/LevelCalculator.js`.

## 🤝 Support

For issues or questions:
1. Check this README thoroughly
2. Review console logs with `DEBUG=true`
3. Verify all environment variables are set correctly
4. Ensure bot has proper Discord permissions

## 📜 License

MIT License - Feel free to modify and use for your own servers!

---

**Made with ❤️ for One Piece fans and Discord communities!** 🏴‍☠️
