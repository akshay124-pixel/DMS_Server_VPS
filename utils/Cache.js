/**
 * Node Cache Configuration
 * Server-side caching using node-cache
 * TTL: 300 seconds (5 minutes)
 */
const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: 300,      // Default TTL: 300 seconds (5 minutes)
  checkperiod: 320  // Check for expired keys every 320 seconds
});

module.exports = cache;
