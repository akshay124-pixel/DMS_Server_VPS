const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/config jwt");
const activeCallsController = require("../Controller/SmartfloActiveCallsController");

/**
 * Active Calls Routes
 * All routes require authentication
 */

// Get all active calls
router.get("/", verifyToken, activeCallsController.getActiveCalls);

// Get call status
router.get("/:callId/status", verifyToken, activeCallsController.getCallStatus);

// Hangup call
router.post("/:callId/hangup", verifyToken, activeCallsController.hangupCall);

// Transfer call
router.post("/:callId/transfer", verifyToken, activeCallsController.transferCall);

// Hold/Unhold call
router.post("/:callId/hold", verifyToken, activeCallsController.holdCall);

module.exports = router;
