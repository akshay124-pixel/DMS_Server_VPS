/**
 * Cache Middleware - Node Cache Operations
 * Provides set, get, delete, and clear operations for server-side caching
 */
const cache = require('../utils/Cache');

/**
 * Set cache with key, data, and optional TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} TTL - Time to live in seconds (default: 300)
 * @returns {boolean} - Success status
 */
const setcache = (key, data, TTL = 300) => {
  try {
    const success = cache.set(key, data, TTL);
    console.log(`Cache set for key ${key} with TTL ${TTL} seconds`);
    return success;
  } catch (error) {
    console.error(`Error setting cache for key ${key}:`, error.message);
    return false;
  }
};

/**
 * Get cached data by key
 * @param {string} key - Cache key
 * @returns {any|null} - Cached data or null if not found
 */
const getCachedData = (key) => {
  try {
    const cachedData = cache.get(key);
    console.log(`Cache lookup for key ${key}: ${cachedData ? 'HIT' : 'MISS'}`);
    return cachedData;
  } catch (error) {
    console.error(`Error getting cache for key ${key}:`, error.message);
    return null;
  }
};

/**
 * Delete single cache key
 * @param {string} key - Cache key to delete
 * @returns {number} - Number of deleted keys
 */
const deleteCache = (key) => {
  try {
    const deletedCount = cache.del(key);
    console.log(deletedCount > 0 ? `Cache with key ${key} deleted` : `Cache key ${key} not found`);
    return deletedCount;
  } catch (error) {
    console.error(`Error deleting cache for key ${key}:`, error.message);
    return 0;
  }
};

/**
 * Clear all cache entries
 * CRITICAL: Use this on any data mutation (create, update, delete, bulk upload)
 * @returns {boolean} - Success status
 */
const clearAllCache = () => {
  try {
    cache.flushAll();
    console.log('All cache cleared');
    return true;
  } catch (error) {
    console.error('Error clearing all cache:', error.message);
    return false;
  }
};

/**
 * Get cache statistics
 * @returns {object} - Cache stats
 */
const getCacheStats = () => {
  try {
    return cache.getStats();
  } catch (error) {
    console.error('Error getting cache stats:', error.message);
    return null;
  }
};

module.exports = {
  setcache,
  getCachedData,
  deleteCache,
  clearAllCache,
  getCacheStats
};
