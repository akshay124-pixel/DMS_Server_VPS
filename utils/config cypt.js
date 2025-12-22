/**
 * JWT Secret Key Configuration
 * 
 * IMPORTANT: In production, use environment variables!
 * Never commit real secrets to version control.
 */

// Use environment variable or fallback to default (for development only)
const secretkey = process.env.JWT_SECRET || "My_DMS_Secret_Key_Change_In_Production_2024";

// Validate secret key strength
if (process.env.NODE_ENV === "production" && secretkey === "My_DMS_Secret_Key_Change_In_Production_2024") {
  console.warn("⚠️  WARNING: Using default JWT secret in production! Please set JWT_SECRET environment variable.");
}

// Check secret key length (should be at least 32 characters)
if (secretkey.length < 32) {
  console.warn("⚠️  WARNING: JWT secret key is too short. Recommended minimum: 32 characters.");
}

module.exports = secretkey;
