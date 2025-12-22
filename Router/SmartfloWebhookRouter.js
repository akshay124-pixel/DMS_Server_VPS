const express = require("express");
const SmartfloWebhookController = require("../Controller/SmartfloWebhookController");

const router = express.Router();

/**
 * Smartflo Webhook Routes
 * These routes are called by Smartflo, not by frontend
 * No authentication required (Smartflo doesn't send JWT tokens)
 * Configure these URLs in Smartflo portal
 */

// Handle call event webhooks
// Configure in Smartflo: https://your-domain.com/api/webhooks/smartflo/call-events
router.post("/call-events", SmartfloWebhookController.handleCallEvents);

// Handle inbound call webhooks
// Configure in Smartflo: https://your-domain.com/api/webhooks/smartflo/inbound
router.post("/inbound", SmartfloWebhookController.handleInboundCall);

module.exports = router;
