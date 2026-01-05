/**
 * Request Logger Middleware
 * Logs API requests with intelligent rate limiting to prevent spam
 */
const logger = require("../utils/logger");

/**
 * Request logging middleware with rate limiting
 * Only logs in development mode and prevents spam
 */
const requestLogger = (req, res, next) => {
  // Only log in development
  if (process.env.NODE_ENV === 'development') {
    const userId = req.user?.id || 'anonymous';
    const endpoint = req.path;
    const method = req.method;
    
    // Skip logging for certain endpoints to reduce noise
    const skipEndpoints = [
      '/health',
      '/favicon.ico',
      '/api/calls/active', // Skip frequent polling endpoints
    ];
    
    const shouldSkip = skipEndpoints.some(skip => endpoint.includes(skip));
    
    if (!shouldSkip) {
      logger.logApiCall(endpoint, method, userId);
    }
  }
  
  next();
};

module.exports = requestLogger;