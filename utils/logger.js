/**
 * Simple logging utility that respects NODE_ENV
 * Only logs in development mode to reduce production noise
 */

const isDevelopment = process.env.NODE_ENV === 'development';

const logger = {
  // Development-only logs
  dev: (...args) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  // Always log errors
  error: (...args) => {
    console.error(...args);
  },
  
  // Always log warnings
  warn: (...args) => {
    console.warn(...args);
  },
  
  // Always log info (for production-relevant information)
  info: (...args) => {
    console.log(...args);
  }
};

module.exports = logger;