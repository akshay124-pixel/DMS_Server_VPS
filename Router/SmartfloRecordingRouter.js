const express = require("express");
const router = express.Router();
const { verifyToken } = require("../utils/config jwt");
const callHistoryController = require("../Controller/SmartfloCallHistoryController");

/**
 * Recording Routes
 * All routes require authentication
 */

// Stream recording (proxy)
router.get("/:id/stream", verifyToken, callHistoryController.streamRecording);

// Get recording metadata
router.get("/:id", verifyToken, callHistoryController.getRecordingMetadata);

module.exports = router;
