# Use Node.js 18 with build tools
FROM node:18-bullseye

# Install canvas dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create assets directory (optional)
RUN mkdir -p assets/fonts

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
