const jwt = require("jsonwebtoken");

// ✅ Environment variables se secrets lo (with fallback for development)
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "access_secret_dev_key_change_in_prod";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refresh_secret_dev_key_change_in_prod";
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "15m";
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || "7d";

// ✅ Access Token Generate karna
function generateToken(user) {
  const payload = {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion || 0,
    type: "access"
  };

  console.log("🔑 Access Token Generated for:", payload.email);
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

// ✅ Refresh Token Generate karna
function generateRefreshToken(user) {
  const payload = {
    id: user._id.toString(),
    tokenVersion: user.tokenVersion || 0,
    type: "refresh",
  };

  console.log("🔄 Refresh Token Generated for user ID:", payload.id);
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

// ✅ Access Token Verify Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("❌ No token provided or invalid format");
    return res.status(401).json({
      success: false,
      message: "No token provided or invalid format",
      code: "NO_TOKEN"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);

    if (decoded.type !== "access") {
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
        code: "INVALID_TOKEN_TYPE"
      });
    }

    console.log("✅ Token verified for:", decoded.email);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("❌ verifyToken Error:", error.message);
    
    // Token expire hua - frontend ko batao
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Access token expired",
        code: "TOKEN_EXPIRED"
      });
    }
    
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      code: "INVALID_TOKEN"
    });
  }
};

// ✅ Refresh Token Verify Function
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET);

    if (decoded.type !== "refresh") {
      return null;
    }
    return decoded;
  } catch (error) {
    console.error("❌ Refresh Token Verification Error:", error.message);
    return null;
  }
};

module.exports = { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken };