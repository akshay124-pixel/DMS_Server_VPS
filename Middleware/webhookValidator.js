/**
 * Webhook Validation Middleware
 * Validates incoming webhook payloads
 */

/**
 * Validate Smartflo webhook payload
 */
function validateSmartfloWebhook(req, res, next) {
  const { body } = req;
  
  // Basic payload validation
  if (!body || typeof body !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook payload format'
    });
  }
  
  // Validate required fields based on event type
  const requiredFields = ['call_id'];
  const missingFields = requiredFields.filter(field => !body[field]);
  
  if (missingFields.length > 0) {
    // Don't reject - log and continue (Smartflo might have different formats)
  }
  
  // Validate phone number formats if present
  if (body.caller_id && !isValidPhoneNumber(body.caller_id)) {
    // Continue processing even with invalid format
  }
  
  if (body.destination_number && !isValidPhoneNumber(body.destination_number)) {
    // Continue processing even with invalid format
  }
  
  // Add validation timestamp
  req.webhookValidated = {
    timestamp: new Date(),
    eventType: body.event_type || 'unknown',
    callId: body.call_id || 'missing',
    direction: body.direction || body.call_direction || 'unknown'
  };
  
  next();
}

/**
 * Basic phone number validation
 */
function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return false;
  
  // Remove common prefixes and formatting
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  
  // Should be 10-15 digits
  return /^\d{10,15}$/.test(cleaned);
}

/**
 * IP whitelist validation (for production)
 */
function validateIPWhitelist(allowedIPs = []) {
  return (req, res, next) => {
    if (allowedIPs.length === 0) {
      // No whitelist configured, allow all
      return next();
    }
    
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    
    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized IP address'
      });
    }
    
    next();
  };
}

module.exports = {
  validateSmartfloWebhook,
  validateIPWhitelist,
  isValidPhoneNumber,
};