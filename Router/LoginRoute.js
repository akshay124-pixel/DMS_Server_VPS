/**
 * Authentication Routes
 * Handles login, logout, token refresh, password change, and token verification
 */
const { 
  Login, 
  Logout,
  ChangePassword, 
  RefreshToken,
  VerifyToken
} = require("../Controller/AuthLogic");
const { verifyToken } = require("../utils/config jwt");
const express = require("express");
const router = express.Router();

// Public routes (no auth required)
router.post("/login", Login);
router.post("/refresh-token", RefreshToken);

// Protected routes (auth required)
router.post("/logout", verifyToken, Logout);
router.post("/change-password", verifyToken, ChangePassword);
router.get("/verify-token", verifyToken, VerifyToken);

module.exports = router;
