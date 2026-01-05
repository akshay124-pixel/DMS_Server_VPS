const express = require("express");
const SmartfloWebhookController = require("../Controller/SmartfloWebhookController");
const { webhookRateLimit } = require("../Middleware/rateLimiter");
const { validateSmartfloWebhook, validateIPWhitelist } = require("../Middleware/webhookValidator");

const router = express.Router();

/**
 * Smartflo Webhook Routes
 * These routes are called by Smartflo, not by frontend
 * No authentication required (Smartflo doesn't send JWT tokens)
 * Configure these URLs in Smartflo portal
 */

// Apply rate limiting to all webhook routes
router.use(webhookRateLimit);

// Apply IP whitelist if configured (set SMARTFLO_ALLOWED_IPS in .env)
const allowedIPs = process.env.SMARTFLO_ALLOWED_IPS ? 
  process.env.SMARTFLO_ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
router.use(validateIPWhitelist(allowedIPs));

// Apply webhook validation
router.use(validateSmartfloWebhook);

// Handle call event webhooks
// Configure in Smartflo: https://your-domain.com/api/webhooks/smartflo/call-events
router.post("/call-events", SmartfloWebhookController.handleCallEvents);

// Handle inbound call webhooks
// Configure in Smartflo: https://your-domain.com/api/webhooks/smartflo/inbound
router.post("/inbound", SmartfloWebhookController.handleInboundCall);

// DEBUG: Test webhook endpoint to capture all incoming webhooks
router.post("/debug", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Debug webhook received",
    timestamp: new Date().toISOString(),
    data: req.body
  });
});

module.exports = router;
