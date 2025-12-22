/**
 * Authentication Controller
 * Implements dual token system with refresh token rotation
 */
const User = require("../Schema/Model");
const bcrypt = require("bcrypt");
const { generateTokenPair, generateToken, verifyRefreshToken } = require("../utils/config jwt");

/**
 * Signup Controller
 * Creates new user and returns token pair
 */
const Signup = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Validate all fields present
    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check email uniqueness
    const existingEmailUser = await User.findOne({ email });
    if (existingEmailUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash password (bcrypt, salt rounds: 10)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with tokenVersion: 0
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      role,
      tokenVersion: 0,
      refreshToken: null
    });

    // Generate token pair
    const tokens = generateTokenPair(newUser);

    // Save refresh token to DB
    newUser.refreshToken = tokens.refreshToken;
    await newUser.save();

    console.log("Signup: User created with tokens:", {
      id: newUser._id,
      email: newUser.email,
      role: newUser.role
    });

    res.status(201).json({
      message: "Your account has been created successfully!",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken, // Backward compatibility
      user: {
        id: newUser._id.toString(),
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error("Signup Error:", error);
    return res.status(500).json({
      message: "Something went wrong while creating your account. Please try again later."
    });
  }
};

/**
 * Login Controller
 * Validates credentials and returns token pair
 */
const Login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token pair
    const tokens = generateTokenPair(user);

    // Save refresh token to DB
    user.refreshToken = tokens.refreshToken;
    await user.save();

    console.log("Login: Tokens generated for user:", {
      id: user._id,
      email: user.email,
      role: user.role
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: tokens.accessToken, // Backward compatibility
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        isAdmin: user.role === "Admin",
        isSuperadmin: user.role === "Superadmin"
      }
    });
  } catch (error) {
    console.error("Login Error:", error.message);
    return res.status(500).json({
      message: "Oops! Something went wrong while logging you in. Please try again later."
    });
  }
};

/**
 * Refresh Token Controller
 * Implements token rotation - generates new token pair and invalidates old refresh token
 */
const RefreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Check if refresh token provided
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required",
        code: "NO_REFRESH_TOKEN"
      });
    }

    // Verify refresh token signature and type
    const verification = verifyRefreshToken(refreshToken);
    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
        code: "INVALID_REFRESH_TOKEN"
      });
    }

    // Find user by ID from token
    const user = await User.findById(verification.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND"
      });
    }

    // CRITICAL: Compare refresh token with DB (reuse detection)
    if (user.refreshToken !== refreshToken) {
      console.log("RefreshToken: Token reuse detected for user:", user._id);
      // Potential token theft - invalidate all tokens
      user.refreshToken = null;
      await user.save();
      return res.status(401).json({
        success: false,
        message: "Refresh token has been revoked. Please login again.",
        code: "TOKEN_REVOKED"
      });
    }

    // CRITICAL: Check token version (password change invalidation)
    if (user.tokenVersion !== verification.tokenVersion) {
      console.log("RefreshToken: Token version mismatch for user:", user._id);
      return res.status(401).json({
        success: false,
        message: "Token has been invalidated due to password change. Please login again.",
        code: "TOKEN_VERSION_MISMATCH"
      });
    }

    // TOKEN ROTATION: Generate NEW token pair
    const tokens = generateTokenPair(user);

    // Save NEW refresh token to DB (old one invalidated)
    user.refreshToken = tokens.refreshToken;
    await user.save();

    console.log("RefreshToken: New tokens generated for user:", {
      id: user._id,
      email: user.email
    });

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      token: tokens.accessToken, // Backward compatibility
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    });
  } catch (error) {
    console.error("RefreshToken Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to refresh token",
      code: "REFRESH_FAILED"
    });
  }
};

/**
 * Logout Controller
 * Invalidates refresh token in DB
 */
const Logout = async (req, res) => {
  try {
    const userId = req.user.id;

    // Set refresh token to null in DB
    await User.findByIdAndUpdate(userId, { refreshToken: null });

    console.log("Logout: Refresh token cleared for user:", userId);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Logout Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to logout"
    });
  }
};

/**
 * Change Password Controller
 * Increments tokenVersion to invalidate all existing tokens
 */
const ChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, email } = req.body;
    const userId = req.user.id;

    console.log("ChangePassword: Request received", { userId, email });

    // Validate all fields
    if (!currentPassword || !newPassword || !email) {
      return res.status(400).json({ 
        success: false, 
        message: "All fields are required" 
      });
    }

    // Check new password is different
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password"
      });
    }

    // Validate password requirements
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long and include uppercase, lowercase, number, and special character"
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      console.log("ChangePassword: User not found", { userId });
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Verify email matches
    if (user.email !== email) {
      console.log("ChangePassword: Email mismatch", {
        providedEmail: email,
        userEmail: user.email
      });
      return res.status(403).json({
        success: false,
        message: "Email does not match authenticated user"
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      console.log("ChangePassword: Current password incorrect for user", { userId });
      return res.status(401).json({ 
        success: false, 
        message: "Current password is incorrect" 
      });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password and INCREMENT tokenVersion to invalidate all tokens
    user.password = hashedNewPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.refreshToken = null; // Clear refresh token
    user.lastPasswordChange = new Date();
    await user.save();

    console.log("ChangePassword: Password changed successfully for user", {
      userId,
      newTokenVersion: user.tokenVersion
    });

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
      requireRelogin: true
    });
  } catch (error) {
    console.error("Change Password Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "An error occurred while changing password"
    });
  }
};

/**
 * Get User Role Controller
 */
const getUserRole = async (req, res) => {
  try {
    console.log("getUserRole: userId:", req.user.id, "role:", req.user.role);
    return res.status(200).json({
      id: req.user.id,
      role: req.user.role,
      isAdmin: req.user.role === "Admin",
      isSuperadmin: req.user.role === "Superadmin"
    });
  } catch (error) {
    console.error("getUserRole Error:", error.message);
    return res.status(500).json({
      message: "Sorry, we couldn't fetch your user role right now. Please try again later."
    });
  }
};

/**
 * Verify Token Controller
 * Returns user info if token is valid
 */
const VerifyToken = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Token is valid",
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error("VerifyToken Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to verify token"
    });
  }
};

module.exports = { 
  Signup, 
  Login, 
  Logout,
  RefreshToken,
  ChangePassword,
  getUserRole,
  VerifyToken
};
