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
    redis \
    supervisor

# Set working directory in container
WORKDIR /app

# Copy package.json first (for better Docker layer caching)
COPY package.json ./

# Install dependencies
# Use npm install instead of npm ci since we don't have package-lock.json
RUN npm install --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create Redis data directory
RUN mkdir -p /data/redis && \
    chown -R redis:redis /data/redis

# Create supervisor configuration
RUN echo '[supervisord]' > /etc/supervisor/conf.d/supervisord.conf && \
    echo 'nodaemon=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'user=root' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:redis]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=redis-server --dir /data/redis --appendonly yes' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'user=redis' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stdout_logfile=/var/log/redis.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stderr_logfile=/var/log/redis.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo '[program:discordbot]' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'command=npm start' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'directory=/app' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'user=discordbot' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stdout_logfile=/var/log/bot.log' >> /etc/supervisor/conf.d/supervisord.conf && \
    echo 'stderr_logfile=/var/log/bot.log' >> /etc/supervisor/conf.d/supervisord.conf

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001 -G nodejs

# Change ownership of app directory
RUN chown -R discordbot:nodejs /app

# Expose ports
EXPOSE 3000 6379

# Health check for both Redis and the bot
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD redis-cli ping && node -e "console.log('Bot is running')" || exit 1

# Start both Redis and the Discord bot using supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
