/**
 * Node Cache Configuration - REAL-TIME OPTIMIZED
 * Server-side caching optimized for real-time data requirements
 * TTL: Shorter for real-time, longer for static data
 */
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: 60,       // Default TTL: 60 seconds (1 minute) for real-time balance
  checkperiod: 30,  // Check for expired keys every 30 seconds (more frequent cleanup)
  useClones: false, // Better performance, less memory usage
  deleteOnExpire: true, // Automatically delete expired keys
  maxKeys: 10000,   // Limit cache size to prevent memory issues
});

// Real-time cache event logging - only in development
cache.on('set', (key, value) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔄 CACHE SET: ${key} (TTL: ${cache.getTtl(key) ? Math.round((cache.getTtl(key) - Date.now()) / 1000) : 'default'}s)`);
  }
});

cache.on('expired', (key, value) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`⏰ CACHE EXPIRED: ${key} - will fetch fresh data on next request`);
  }
});

cache.on('del', (key, value) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🗑️ CACHE DELETED: ${key} - real-time invalidation`);
  }
});

module.exports = cache;
