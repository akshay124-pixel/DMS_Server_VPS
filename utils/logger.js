/**
 * Smart Logger Utility
 * Prevents log spam by implementing rate limiting and intelligent filtering
 */

class SmartLogger {
  constructor() {
    this.logCache = new Map();
    this.cleanupInterval = null;
    this.init();
  }

  init() {
    // Clean up old entries every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      const fiveMinutesAgo = Date.now() - 300000;
      for (const [key, data] of this.logCache.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
          this.logCache.delete(key);
        }
      }
    }, 300000);
  }

  /**
   * Log with rate limiting
   * @param {string} key - Unique key for this log type
   * @param {string} message - Log message
   * @param {Object} data - Additional data to log
   * @param {number} cooldown - Cooldown period in milliseconds (default: 30 seconds)
   */
  logWithRateLimit(key, message, data = {}, cooldown = 30000) {
    const now = Date.now();
    const cached = this.logCache.get(key);

    // Only log if we haven't logged this key recently
    if (!cached || (now - cached.timestamp) > cooldown) {
      console.log(message, data);
      this.logCache.set(key, { timestamp: now });
      return true;
    }
    return false;
  }

  /**
   * Log token verification (specialized method)
   * @param {Object} user - User data from token
   */
  logTokenVerification(user) {
    if (process.env.NODE_ENV === 'development') {
      const key = `token_verify_${user.id}`;
      this.logWithRateLimit(
        key,
        "verifyToken: Token verified successfully",
        {
          id: user.id,
          email: user.email,
          role: user.role
        },
        30000 // 30 seconds cooldown
      );
    }
  }

  /**
   * Log API calls (specialized method)
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {string} userId - User ID making the request
   */
  logApiCall(endpoint, method, userId) {
    if (process.env.NODE_ENV === 'development') {
      const key = `api_call_${userId}_${endpoint}_${method}`;
      this.logWithRateLimit(
        key,
        `API Call: ${method} ${endpoint}`,
        { userId },
        10000 // 10 seconds cooldown for API calls
      );
    }
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.logCache.clear();
  }
}

// Create singleton instance
const logger = new SmartLogger();

// Cleanup on process exit
process.on('exit', () => {
  logger.destroy();
});

process.on('SIGINT', () => {
  logger.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.destroy();
  process.exit(0);
});

module.exports = logger;