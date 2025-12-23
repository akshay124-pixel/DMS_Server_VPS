/**
 * Authentication Middleware
 * Re-exports JWT middleware for backward compatibility
 */
const { verifyToken, requireRole, requireAdmin } = require("../utils/config jwt");

module.exports = {
  verifyToken,
  requireRole,
  requireAdmin
};
