/**
 * JWT Configuration - Production Ready Dual Token System
 * Implements refresh token rotation with token version tracking
 */
const jwt = require("jsonwebtoken");

// Token Secrets
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "access_secret_dev_key_change_in_prod";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_REFRESH_SECRET || "refresh_secret_dev_key_change_in_prod";

// Token Expiration Times
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || process.env.JWT_EXPIRY || "15m";
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || process.env.JWT_REFRESH_EXPIRY || "7d";

/**
 * Generate Access Token
 * Short-lived token for API access (15 minutes default)
 * @param {Object} user - User object from database
 * @returns {string} - JWT access token
 */
function generateToken(user) {
  const payload = {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion || 0,
    type: "access"
  };

  // Token generation logged without sensitive data
  if (process.env.NODE_ENV === 'development') {
    console.log("generateToken: Generating access token for user:", {
      id: payload.id,
      role: payload.role,
      tokenVersion: payload.tokenVersion
    });
  }

  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY
  });
}

/**
 * Generate Refresh Token
 * Long-lived token for getting new access tokens (7 days default)
 * @param {Object} user - User object from database
 * @returns {string} - JWT refresh token
 */
function generateRefreshToken(user) {
  const payload = {
    id: user._id.toString(),
    tokenVersion: user.tokenVersion || 0,
    type: "refresh"
  };

  // Token generation logged without sensitive data
  if (process.env.NODE_ENV === 'development') {
    console.log("generateRefreshToken: Generating refresh token for user:", {
      id: payload.id,
      tokenVersion: payload.tokenVersion
    });
  }

  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY
  });
}

/**
 * Generate Both Tokens (Token Pair)
 * Returns both access and refresh tokens
 * @param {Object} user - User object from database
 * @returns {Object} - { accessToken, refreshToken, expiresIn }
 */
function generateTokenPair(user) {
  return {
    accessToken: generateToken(user),
    refreshToken: generateRefreshToken(user),
    expiresIn: ACCESS_TOKEN_EXPIRY
  };
}

/**
 * Verify Access Token Middleware
 * Validates JWT token from Authorization header
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Check if Authorization header exists and has correct format
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("verifyToken: No token provided or invalid format");
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please provide a valid token.",
      code: "NO_TOKEN"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify token signature
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);

    // Check token type - must be "access"
    if (decoded.type !== "access") {
      console.log("verifyToken: Invalid token type:", decoded.type);
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
        code: "INVALID_TOKEN_TYPE"
      });
    }

    console.log("verifyToken: Token verified successfully", {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    });

    // Attach user info to request
    req.user = {
      id: decoded.id,
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      tokenVersion: decoded.tokenVersion
    };

    next();
  } catch (error) {
    console.error("verifyToken Error:", error.message);

    // Handle specific JWT errors
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired. Please login again.",
        code: "TOKEN_EXPIRED",
        expiredAt: error.expiredAt
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token. Please login again.",
        code: "INVALID_TOKEN"
      });
    }

    // Generic error
    return res.status(401).json({
      success: false,
      message: "Authentication failed. Please login again.",
      code: "AUTH_FAILED"
    });
  }
};

/**
 * Verify Refresh Token
 * Validates refresh token for getting new access token
 * @param {string} token - Refresh token to verify
 * @returns {Object} - { valid, userId, tokenVersion, error }
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET);

    // Check token type - must be "refresh"
    if (decoded.type !== "refresh") {
      return {
        valid: false,
        error: "Invalid token type"
      };
    }

    return {
      valid: true,
      userId: decoded.id,
      tokenVersion: decoded.tokenVersion
    };
  } catch (error) {
    console.error("verifyRefreshToken Error:", error.message);
    return {
      valid: false,
      error: error.message
    };
  }
};

/**
 * Role-based middleware
 * Checks if user has required role
 * @param {...string} allowedRoles - Allowed roles
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NO_AUTH"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.log(`requireRole: User lacks required role. Has: ${req.user.role}, Needs: ${allowedRoles.join(" or ")}`);
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource",
        code: "INSUFFICIENT_PERMISSIONS",
        requiredRole: allowedRoles,
        userRole: req.user.role
      });
    }

    next();
  };
};

/**
 * Admin-only middleware
 * Shorthand for requiring Admin or Superadmin role
 */
const requireAdmin = requireRole("Admin", "Superadmin");

/**
 * Decode token without verification (for debugging)
 * WARNING: Do not use for authentication!
 * @param {string} token - Token to decode
 * @returns {Object|null} - Decoded payload or null
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    console.error("decodeToken Error:", error.message);
    return null;
  }
};

module.exports = {
  generateToken,
  generateRefreshToken,
  generateTokenPair,
  verifyToken,
  verifyRefreshToken,
  requireRole,
  requireAdmin,
  decodeToken,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET
};
