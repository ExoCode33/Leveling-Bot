/**
     * Set cache value with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async setCache(key, value, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since RedisCacheManager already adds it
                const finalKey = key.startsWith('Leveling-Bot:') ? key : `Leveling-Bot:${key}`;
                await this.redis.setex(finalKey, ttlSeconds, typeof value === 'object' ? JSON.stringify(value) : value);
                return true;
            } else {
                // FALLBACK: Use memory cache
                this.memoryCache.set(key, value);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached ${key} in memory (TTL: ${ttlSeconds}s)`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Redis error, falling back to memory:', error.message);
            // Auto-fallback to memory cache on Redis error
            this.memoryCache.set(key, value);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get cache value with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async getCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since RedisCacheManager already adds it
                const finalKey = key.startsWith('Leveling-Bot:') ? key : `Leveling-Bot:${key}`;
                const value = await this.redis.get(finalKey);
                if (value) {
                    try {
                        return JSON.parse(value);
                    } catch {
                        return value; // Return as string if not JSON
                    }
                }
                return null;
            } else {
                // FALLBACK: Use memory cache
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    // Expired
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const value = this.memoryCache.get(key);
                if (value !== undefined) {
                    return value;
                }
                return null;
            }
        } catch (error) {
            console.error('[CACHE] Redis error, trying memory cache:', error.message);
            // Auto-fallback to memory cache on Redis error
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Delete cache key with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async deleteCache(key) {
        try {
            if (this.isRedisAvailable()) {
                const finalKey = key.startsWith('Leveling-Bot:') ? key : `Leveling-Bot:${key}`;
                await this.redis.del(finalKey);
            }
            // Also delete from memory cache (in case of fallback scenarios)
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);
            return true;
        } catch (error) {
            console.error('[CACHE] Error deleting cache, cleaning memory:', error.message);
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);
            return true;
        }
    }

    /**
     * Set binary cache (for images) with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async setBinaryCache(key, buffer, ttlSeconds = 3600) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since RedisCacheManager already adds it
                const finalKey = key.startsWith('Leveling-Bot:') ? key : `Leveling-Bot:${key}`;
                await this.redis.setex(finalKey, ttlSeconds, buffer);
                return true;
            } else {
                // FALLBACK: Store buffer in memory cache
                this.memoryCache.set(key, buffer);
                this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
                console.log(`[FALLBACK] Cached binary ${key} in memory (${Math.round(buffer.length / 1024)}KB)`);
                return true;
            }
        } catch (error) {
            console.error('[CACHE] Redis binary error, using memory:', error.message);
            // Auto-fallback to memory cache
            this.memoryCache.set(key, buffer);
            this.memoryCacheTTL.set(key, Date.now() + (ttlSeconds * 1000));
            return true;
        }
    }

    /**
     * Get binary cache with Redis priority and memory fallback - FIXED: Prevent double prefix
     */
    async getBinaryCache(key) {
        try {
            if (this.isRedisAvailable()) {
                // FIXED: Don't add prefix here since RedisCacheManager already adds it
                const finalKey = key.startsWith('Leveling-Bot:') ? key : `Leveling-Bot:${key}`;
                return await this.redis.getBuffer(finalKey);
            } else {
                // FALLBACK: Get from memory cache
                const ttl = this.memoryCacheTTL.get(key);
                if (ttl && Date.now() > ttl) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    return null;
                }
                
                const buffer = this.memoryCache.get(key);
                if (buffer) {
                    return buffer;
                }
                return null;
            }
        } catch (error) {
            console.error('[CACHE] Redis binary error, trying memory:', error.message);
            // Auto-fallback to memory cache
            const ttl = this.memoryCacheTTL.get(key);
            if (ttl && Date.now() <= ttl) {
                return this.memoryCache.get(key);
            }
            return null;
        }
    }

    /**
     * Clear pattern with Redis priority and limited memory fallback - FIXED: Handle double prefix
     */
    async clearPattern(pattern) {
        try {
            let redisCleared = 0;
            
            if (this.isRedisAvailable()) {
                // FIXED: Handle both single and double prefix patterns
                const patterns = [
                    pattern,
                    pattern.replace('Leveling-Bot:', 'Leveling-Bot:Leveling-Bot:') // Also clear double prefixed keys
                ];
                
                for (const searchPattern of patterns) {
                    const keys = await this.redis.keys(searchPattern);
                    if (keys.length > 0) {
                        await this.redis.del(...keys);
                        redisCleared += keys.length;
                        console.log(`[CACHE] Cleared ${keys.length} keys matching pattern: ${searchPattern}`);
                    }
                }
            }
            
            // ALSO clear from memory cache (for consistency)
            let memoryCleared = 0;
            const searchTerm = pattern.replace(/\*/g, '').replace('Leveling-Bot:', '');
            for (const [key] of this.memoryCache) {
                if (key.includes(searchTerm)) {
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                    memoryCleared++;
                }
            }
            
            const totalCleared = redisCleared + memoryCleared;
            if (totalCleared > 0) {
                console.log(`[CACHE] Cleared ${redisCleared} Redis + ${memoryCleared} memory keys`);
            }
            
            return totalCleared;
        } catch (error) {
            console.error('[CACHE] Error clearing pattern:', error.message);
            return 0;
        }
    }
