/**
 * Rate Limiting Middleware
 * Protects webhook endpoints from abuse using shared cache
 */

const { getCachedData, setcache } = require('../Middleware/CacheMiddleware');

/**
 * Rate limiter for webhook endpoints using shared cache
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 */
function createRateLimiter(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const key = `rate_limit_${clientIP}`;
    
    const current = getCachedData(key) || { count: 0, resetTime: Date.now() + windowMs };
    
    // Reset counter if window has expired
    if (Date.now() > current.resetTime) {
      current.count = 0;
      current.resetTime = Date.now() + windowMs;
    }
    
    current.count++;
    setcache(key, current, Math.ceil(windowMs / 1000)); // Convert to seconds for TTL
    
    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - current.count),
      'X-RateLimit-Reset': new Date(current.resetTime).toISOString(),
    });
    
    // Rate limit check (IP not logged for privacy)
    if (current.count > maxRequests) {
      console.log(`🚫 Rate limit exceeded (${current.count}/${maxRequests})`);
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        retryAfter: Math.ceil((current.resetTime - Date.now()) / 1000),
      });
    }
    
    // Rate limit passed - only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Rate limit check passed (${current.count}/${maxRequests})`);
    }
    next();
  };
}

const webhookRateLimit = createRateLimiter(200, 60000); // 200 requests per minute

/**
 * API rate limiter (more restrictive)
 */
const apiRateLimit = createRateLimiter(60, 60000); // 60 requests per minute

module.exports = {
  webhookRateLimit,
  apiRateLimit,
  createRateLimiter,
};