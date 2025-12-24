const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/config jwt");
const callHistoryController = require("../Controller/SmartfloCallHistoryController");

/**
 * Call History Routes
 * All routes require authentication
 */

// Get call history with filters and pagination
router.get("/", verifyToken, callHistoryController.getCallHistory);

// Get call statistics
router.get("/stats", verifyToken, callHistoryController.getCallStats);

// Debug: Get calls with recordings (temporary)
router.get("/debug/recordings", verifyToken, callHistoryController.debugRecordings);

// Export call history
router.post("/export", verifyToken, callHistoryController.exportCallHistory);

// Get single call details
router.get("/:id", verifyToken, callHistoryController.getCallDetails);

module.exports = router;
