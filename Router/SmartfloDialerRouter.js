const express = require("express");
const SmartfloDialerController = require("../Controller/SmartfloDialerController");
const { verifyToken } = require("../utils/config jwt");

const router = express.Router();

/**
 * Smartflo Dialer Routes
 * All routes require authentication
 */

// Click-to-call
router.post("/click-to-call", verifyToken, SmartfloDialerController.clickToCall);

// Get call logs with filters
router.get("/call-logs", verifyToken, SmartfloDialerController.getCallLogs);

// Get call history for specific lead
router.get("/call-logs/:leadId", verifyToken, SmartfloDialerController.getLeadCallHistory);

// Manually log a call
router.post("/manual-log", verifyToken, SmartfloDialerController.manualCallLog);

// ===== SCHEDULED CALLS ROUTES =====

// Schedule a future call
router.post("/schedule-call", verifyToken, SmartfloDialerController.scheduleCall);

// Get all scheduled calls (with filters)
router.get("/scheduled-calls", verifyToken, SmartfloDialerController.getScheduledCalls);

// Get upcoming calls (next 24 hours by default)
router.get("/scheduled-calls/upcoming/today", verifyToken, SmartfloDialerController.getUpcomingCalls);

// Get overdue calls
router.get("/scheduled-calls/overdue", verifyToken, SmartfloDialerController.getOverdueCalls);

// Get scheduled calls statistics
router.get("/scheduled-calls/stats", verifyToken, SmartfloDialerController.getScheduledCallsStats);

// Get scheduled calls for specific lead
router.get("/scheduled-calls/:leadId", verifyToken, SmartfloDialerController.getLeadScheduledCalls);

// Update a scheduled call
router.patch("/scheduled-calls/:id", verifyToken, SmartfloDialerController.updateScheduledCall);

// Mark scheduled call as completed
router.patch("/scheduled-calls/:id/complete", verifyToken, SmartfloDialerController.completeScheduledCall);

// Delete a scheduled call
router.delete("/scheduled-calls/:id", verifyToken, SmartfloDialerController.deleteScheduledCall);

module.exports = router;
