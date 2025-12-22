const express = require("express");
const SmartfloAnalyticsController = require("../Controller/SmartfloAnalyticsController");
const { verifyToken } = require("../utils/config jwt");

const router = express.Router();

/**
 * Smartflo Analytics Routes
 * All routes require authentication
 */

// Get call summary statistics
router.get("/call-summary", verifyToken, SmartfloAnalyticsController.getCallSummary);

// Get agent performance metrics
router.get("/agent-performance", verifyToken, SmartfloAnalyticsController.getAgentPerformance);

// Get daily call trends
router.get("/call-trends", verifyToken, SmartfloAnalyticsController.getCallTrends);

// Sync CDR from Smartflo (Admin only)
router.post("/sync-cdr", verifyToken, SmartfloAnalyticsController.syncCDR);

module.exports = router;
