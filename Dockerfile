# Use official Node.js runtime as base image
FROM node:18-alpine

# Install system dependencies for Canvas, build tools, and Redis
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    make \
    g++ \
    python3 \
    redis

# Set working directory in container
WORKDIR /app

# Copy package.json first (for better Docker layer caching)
COPY package.json ./

# Install dependencies
RUN npm install --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create startup script that starts Redis then the bot
RUN cat > /app/start.sh << 'EOF'
#!/bin/sh
set -e

echo "🔴 Starting Redis server..."
redis-server --daemonize yes --appendonly yes --dir /tmp --save 60 1

echo "🔄 Waiting for Redis to be ready..."
timeout=30
while [ $timeout -gt 0 ]; do
    if redis-cli ping > /dev/null 2>&1; then
        echo "✅ Redis is ready!"
        break
    fi
    echo "Redis is not ready, waiting... ($timeout seconds left)"
    sleep 1
    timeout=$((timeout-1))
done

if [ $timeout -eq 0 ]; then
    echo "❌ Redis failed to start within 30 seconds"
    exit 1
fi

echo "🚀 Starting One Piece XP Bot..."
exec npm start
EOF

# Make the script executable
RUN chmod +x /app/start.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

# Change ownership of app directory (but keep start.sh executable by root)
RUN chown -R discordbot:nodejs /app && \
    chmod 755 /app/start.sh

# Expose port
EXPOSE 3000

# Health check (check both Redis and bot)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD redis-cli ping > /dev/null 2>&1 && node -e "console.log('Bot is running')" || exit 1

# Start Redis and the bot using the startup script
CMD ["/app/start.sh"]
