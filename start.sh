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
