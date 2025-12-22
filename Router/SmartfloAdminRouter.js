const express = require("express");
const SmartfloAdminController = require("../Controller/SmartfloAdminController");
const { verifyToken } = require("../utils/config jwt");

const router = express.Router();

/**
 * Smartflo Admin Routes
 * All routes require authentication
 * Some routes require admin privileges (checked in controller)
 */

// Get all users with Smartflo mapping
router.get("/users", verifyToken, SmartfloAdminController.getAllUsersWithMapping);

// Map user to Smartflo agent (Admin only)
router.put("/users/:userId/map", verifyToken, SmartfloAdminController.mapUserToSmartflo);

// Sync leads to Smartflo lead list (Admin only)
router.post("/lead-sync", verifyToken, SmartfloAdminController.syncLeadsToSmartflo);

// Create dialer campaign (Admin only)
router.post("/campaign/create", verifyToken, SmartfloAdminController.createCampaign);

// Get all campaigns
router.get("/campaigns", verifyToken, SmartfloAdminController.getCampaigns);

// Get Smartflo dispositions
router.get("/dispositions", verifyToken, SmartfloAdminController.getDispositions);

// Test Smartflo connection (Admin only)
router.post("/test-connection", verifyToken, SmartfloAdminController.testConnection);

module.exports = router;
