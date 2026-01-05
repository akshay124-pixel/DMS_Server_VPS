/**
 * Cache Middleware - Smart Cache Operations with Selective Invalidation
 * Provides set, get, delete, and intelligent cache management
 */
const cache = require('../utils/Cache');

/**
 * Set cache with key, data, and optional TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} TTL - Time to live in seconds (default: 60)
 * @returns {boolean} - Success status
 */
const setcache = (key, data, TTL = 60) => {
  // Cache operations - only log in development to reduce noise
  try {
    const success = cache.set(key, data, TTL);
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ CACHE SET: ${key} (TTL: ${TTL}s)`);
    }
    return success;
  } catch (error) {
    console.error(`❌ Error setting cache for key ${key}:`, error.message);
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
    // Only log cache hits/misses in development to reduce noise
    if (process.env.NODE_ENV === 'development') {
      if (cachedData) {
        console.log(`🎯 CACHE HIT: ${key}`);
      } else {
        console.log(`❌ CACHE MISS: ${key}`);
      }
    }
    return cachedData;
  } catch (error) {
    console.error(`❌ Error getting cache for key ${key}:`, error.message);
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
    if (deletedCount > 0 && process.env.NODE_ENV === 'development') {
      console.log(`🗑️ CACHE DELETED: ${key}`);
    }
    return deletedCount;
  } catch (error) {
    console.error(`❌ Error deleting cache for key ${key}:`, error.message);
    return 0;
  }
};

/**
 * SMART: Clear cache by pattern and immediately refresh with new data
 * @param {string} pattern - Pattern to match cache keys
 * @param {Function} refreshFunction - Function to get fresh data
 * @param {Object} refreshParams - Parameters for refresh function
 * @returns {Promise<boolean>} - Success status
 */
const smartCacheRefresh = async (pattern, refreshFunction = null, refreshParams = {}) => {
  try {
    // Get all cache keys
    const allKeys = cache.keys();
    
    // Find keys matching pattern
    const matchingKeys = allKeys.filter(key => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(key);
      }
      return key.includes(pattern);
    });
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 SMART REFRESH: Found ${matchingKeys.length} keys matching pattern`);
    }
    
    // Delete matching keys
    matchingKeys.forEach(key => {
      cache.del(key);
      if (process.env.NODE_ENV === 'development') {
        console.log(`🗑️ SMART DELETE: ${key}`);
      }
    });
    
    // If refresh function provided, immediately cache fresh data
    if (refreshFunction && typeof refreshFunction === 'function') {
      try {
        const freshData = await refreshFunction(refreshParams);
        if (freshData && refreshParams.cacheKey) {
          setcache(refreshParams.cacheKey, freshData, refreshParams.ttl || 60);
          if (process.env.NODE_ENV === 'development') {
            console.log(`✅ SMART REFRESH: Cached fresh data`);
          }
        }
      } catch (refreshError) {
        console.error(`❌ SMART REFRESH ERROR:`, refreshError.message);
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Smart cache refresh error:', error.message);
    return false;
  }
};

/**
 * SMART: Invalidate cache based on data type and user
 * @param {string} dataType - Type of data changed (calls, entries, users)
 * @param {string} userId - User ID for user-specific invalidation
 * @param {Object} options - Additional options
 */
const smartInvalidate = (dataType, userId = null, options = {}) => {
  try {
    // Smart invalidation logged without sensitive user data
    if (process.env.NODE_ENV === 'development') {
      console.log(`🧠 SMART INVALIDATE: ${dataType} for user ${userId ? '[REDACTED]' : 'all'}`);
    }
    
    const patterns = [];
    
    switch (dataType) {
      case 'calls':
        patterns.push('call_history_*');
        patterns.push('call_stats_*');
        patterns.push('call_details_*');
        if (userId) {
          patterns.push(`*_${userId}_*`);
        }
        break;
        
      case 'entries':
        patterns.push('entries_*');
        patterns.push('entry_counts_*');
        if (userId) {
          patterns.push(`*_${userId}_*`);
        }
        break;
        
      case 'users':
        patterns.push('user_role_*');
        if (userId) {
          patterns.push(`user_role_${userId}`);
        }
        break;
        
      case 'all':
        cache.flushAll();
        console.log('🗑️ SMART INVALIDATE: All cache cleared');
        return true;
    }
    
    // Delete matching patterns
    patterns.forEach(pattern => {
      const allKeys = cache.keys();
      const matchingKeys = allKeys.filter(key => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(key);
      });
      
      matchingKeys.forEach(key => {
        cache.del(key);
        if (process.env.NODE_ENV === 'development') {
          console.log(`🗑️ SMART INVALIDATE: ${key}`);
        }
      });
    });
    
    return true;
  } catch (error) {
    console.error('❌ Smart invalidate error:', error.message);
    return false;
  }
};

/**
 * Clear all cache entries
 * @returns {boolean} - Success status
 */
const clearAllCache = () => {
  try {
    cache.flushAll();
    console.log('🗑️ ALL CACHE CLEARED');
    return true;
  } catch (error) {
    console.error('❌ Error clearing all cache:', error.message);
    return false;
  }
};

/**
 * Get cache statistics
 * @returns {object} - Cache stats
 */
const getCacheStats = () => {
  try {
    const stats = cache.getStats();
    console.log('📊 CACHE STATS:', {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%' : '0%'
    });
    return stats;
  } catch (error) {
    console.error('❌ Error getting cache stats:', error.message);
    return null;
  }
};

module.exports = {
  setcache,
  getCachedData,
  deleteCache,
  clearAllCache,
  getCacheStats,
  smartCacheRefresh,
  smartInvalidate
};
