/**
 * LRU (Least Recently Used) Cache implementation with O(1) eviction
 * Replaces the original O(n) cache cleanup that could block the UI
 */

import { CONSTANTS } from './constants.js';
import { debugLog } from './logger.js';

/**
 * LRU Cache with timestamp-based expiration and size limits
 */
class LRUCache {
    /**
     * @param {number} maxSize - Maximum number of entries
     * @param {number} maxAge - Maximum age in milliseconds
     */
    constructor(maxSize = CONSTANTS.CACHE_MAX_SIZE, maxAge = CONSTANTS.CACHE_MAX_AGE_MS) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.maxAge = maxAge;
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {any|null} Cached value or null if not found/expired
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        // Check expiration
        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            debugLog(`Cache expired: ${key}`);
            return null;
        }

        // Move to end (most recently used) by re-inserting
        this.cache.delete(key);
        this.cache.set(key, { ...entry, timestamp: Date.now(), accessCount: entry.accessCount + 1 });

        debugLog(`Cache hit: ${key} (accessed ${entry.accessCount + 1} times)`);
        return entry.value;
    }

    /**
     * Set value in cache with automatic LRU eviction
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     */
    set(key, value) {
        // If at capacity, evict oldest entry (first in Map)
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            debugLog(`Cache evicted (LRU): ${firstKey}`);
        }

        // Add or update entry
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            accessCount: 0
        });

        debugLog(`Cache set: ${key} (size: ${this.cache.size}/${this.maxSize})`);
    }

    /**
     * Check if key exists in cache
     * @param {string} key - Cache key
     * @returns {boolean} Whether key exists and is not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check expiration
        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete entry from cache
     * @param {string} key - Cache key
     * @returns {boolean} Whether entry was deleted
     */
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            debugLog(`Cache deleted: ${key}`);
        }
        return deleted;
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        debugLog(`Cache cleared: ${size} entries removed`);
    }

    /**
     * Get current cache size
     * @returns {number} Number of entries in cache
     */
    size() {
        return this.cache.size;
    }

    /**
     * Get all cache keys
     * @returns {string[]} Array of cache keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }

    /**
     * Clean up expired entries
     * @returns {number} Number of entries cleaned up
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.maxAge) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            debugLog(`Cache cleanup: ${cleaned} expired entries removed`);
        }

        return cleaned;
    }

    /**
     * Get cache statistics
     * @returns {object} Cache stats
     */
    getStats() {
        const entries = Array.from(this.cache.values());
        const totalAccesses = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
        const avgAge = entries.reduce((sum, entry) => sum + (Date.now() - entry.timestamp), 0) / entries.length;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            totalAccesses,
            avgAccessCount: entries.length > 0 ? totalAccesses / entries.length : 0,
            avgAgeMs: entries.length > 0 ? avgAge : 0
        };
    }
}

/**
 * Global response cache instance
 */
export const responseCache = new LRUCache(
    CONSTANTS.CACHE_MAX_SIZE,
    CONSTANTS.CACHE_MAX_AGE_MS
);

/**
 * Create a cache key from generation parameters
 * @param {object} params - Generation parameters
 * @returns {string} Cache key
 */
export function createCacheKey(params) {
    const {
        workflowName,
        prompt,
        negativePrompt,
        seed,
        steps,
        cfg,
        model,
        sampler,
        width,
        height
    } = params;

    // Create deterministic key from stable parameters
    // Exclude random seed to allow caching of similar generations
    const keyParts = [
        workflowName,
        prompt,
        negativePrompt || '',
        steps,
        cfg,
        model || '',
        sampler || '',
        width,
        height
    ];

    // Use simple string concatenation with delimiter
    return keyParts.join('|');
}

/**
 * Get cached generation result if available
 * @param {object} params - Generation parameters
 * @returns {any|null} Cached result or null
 */
export function getCachedResult(params) {
    const key = createCacheKey(params);
    return responseCache.get(key);
}

/**
 * Cache generation result
 * @param {object} params - Generation parameters
 * @param {any} result - Generation result
 */
export function cacheResult(params, result) {
    const key = createCacheKey(params);
    responseCache.set(key, result);
}

/**
 * Clear generation cache
 */
export function clearGenerationCache() {
    responseCache.clear();
}

/**
 * Get cache statistics
 * @returns {object} Cache stats
 */
export function getCacheStats() {
    return responseCache.getStats();
}
