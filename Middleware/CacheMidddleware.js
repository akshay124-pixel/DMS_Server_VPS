const cache = require("../utils/Cache");

const cacheMiddleware = (key) => (req, res, next) => {
    const cachedData = cache.get(key);
    console.log(`Cache lookup for key ${key}: ${cachedData ? 'HIT' : 'MISS'}`);
    if (cachedData) {
        return res.json({
            success: true,
            data: cachedData,
            message: "Data fetched from cache"
        });
    }
    next(); // Continue to next middleware if no cache hit
};

// Helper function to check cache directly
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

// Get cache statistics
const getCacheStats = () => {
    try {
        return cache.getStats();
    } catch (error) {
        console.error('Error getting cache stats:', error.message);
        return null;
    }
};

// Clear all cache
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

const setcache = (key, data, TTL = 300) => {
    try {
        const success = cache.set(key, data, TTL);
        if (success) {
            console.log(`Cache set for key ${key} with TTL ${TTL} seconds`);
        } else {
            console.warn(`Failed to set cache for key ${key}`);
        }
        return success;
    } catch (error) {
        console.error(`Error setting cache for key ${key}:`, error.message);
        return false;
    }
};
const deleteCache = (key) => {
    try {
        const deletedCount = cache.del(key);
        if (deletedCount > 0) {
            console.log(`Cache with key ${key} deleted`);
        } else {
            console.log(`Cache key ${key} not found for deletion`);
        }
        return deletedCount;
    } catch (error) {
        console.error(`Error deleting cache for key ${key}:`, error.message);
        return 0;
    }
};
module.exports = { 
    cacheMiddleware, 
    setcache, 
    deleteCache, 
    getCachedData, 
    getCacheStats, 
    clearAllCache 
};