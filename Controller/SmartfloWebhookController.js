const CallLog = require("../Schema/CallLogModel");
const Entry = require("../Schema/DataModel");

/**
 * Smartflo Webhook Controller
 * Handles incoming webhooks from Smartflo for call events
 * Configure webhook URL in Smartflo portal: https://your-domain.com/api/webhooks/smartflo/call-events
 */

/**
 * Handle call event webhooks from Smartflo
 * POST /api/webhooks/smartflo/call-events
 * 
 * Smartflo sends events like:
 * - call.initiated
 * - call.ringing
 * - call.answered
 * - call.completed
 * - call.failed
 * - call.no_answer
 */
exports.handleCallEvents = async (req, res) => {
  try {
    const webhookData = req.body;
    
    console.log("Smartflo webhook received:", JSON.stringify(webhookData, null, 2));

    // Verify webhook authenticity (optional - implement signature verification)
    // const signature = req.headers['x-smartflo-signature'];
    // if (!verifyWebhookSignature(signature, webhookData)) {
    //   return res.status(401).json({ message: "Invalid webhook signature" });
    // }

    // Extract call details from webhook
    const {
      call_id,
      custom_identifier,
      event_type,
      call_status,
      agent_number,
      destination_number,
      caller_id,
      start_time,
      end_time,
      duration,
      recording_url,
      disposition,
      direction,
    } = webhookData;

    // Find call log by provider call ID or custom identifier
    let callLog = await CallLog.findOne({
      $or: [
        { providerCallId: call_id },
        { customIdentifier: custom_identifier },
      ],
    });

    if (!callLog) {
      // If call log doesn't exist (e.g., inbound call), create new one
      console.log("Creating new call log from webhook");
      
      // Try to find lead by phone number
      const lead = await Entry.findOne({ mobileNumber: destination_number });
      
      if (!lead) {
        console.warn("No lead found for destination number:", destination_number);
        return res.status(200).json({ message: "Webhook received but no matching lead" });
      }

      callLog = new CallLog({
        leadId: lead._id,
        userId: lead.createdBy, // Default to lead creator
        agentNumber: agent_number,
        destinationNumber: destination_number,
        callerId: caller_id,
        providerCallId: call_id,
        customIdentifier: custom_identifier,
        callStatus: mapSmartfloStatus(call_status || event_type),
        callDirection: direction || "inbound",
        webhookData,
      });
    } else {
      // Update existing call log
      callLog.callStatus = mapSmartfloStatus(call_status || event_type);
      callLog.webhookData = webhookData;
    }

    // Update timing information
    if (start_time) {
      callLog.startTime = new Date(start_time);
    }
    if (end_time) {
      callLog.endTime = new Date(end_time);
    }
    if (duration !== undefined) {
      callLog.duration = parseInt(duration);
    }

    // Update recording URL
    if (recording_url) {
      callLog.recordingUrl = recording_url;
    }

    // Update disposition
    if (disposition) {
      callLog.disposition = disposition;
    }

    await callLog.save();

    // Update lead information
    if (callLog.leadId) {
      const lead = await Entry.findById(callLog.leadId);
      if (lead) {
        lead.lastCallDate = new Date();
        lead.lastCallStatus = callLog.callStatus;
        
        // Update lead status based on call outcome
        if (callLog.callStatus === "completed" && callLog.duration > 30) {
          // Call was answered and lasted more than 30 seconds
          if (lead.status === "Not Found") {
            lead.status = "Interested"; // Or map based on disposition
          }
        } else if (callLog.callStatus === "no_answer" || callLog.callStatus === "failed") {
          // Schedule follow-up
          if (!lead.callbackScheduled) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            lead.callbackScheduled = tomorrow;
            lead.callbackReason = "Follow-up after no answer";
          }
        }

        await lead.save();
      }
    }

    // Send success response to Smartflo
    res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      callLogId: callLog._id,
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    
    // Still return 200 to prevent Smartflo from retrying
    res.status(200).json({
      success: false,
      message: "Webhook received but processing failed",
      error: error.message,
    });
  }
};

/**
 * Handle inbound call webhooks
 * POST /api/webhooks/smartflo/inbound
 */
exports.handleInboundCall = async (req, res) => {
  try {
    const webhookData = req.body;
    
    console.log("Inbound call webhook received:", JSON.stringify(webhookData, null, 2));

    const {
      call_id,
      caller_number,
      called_number,
      call_status,
      start_time,
    } = webhookData;

    // Find lead by caller number
    const lead = await Entry.findOne({ mobileNumber: caller_number });

    if (lead) {
      // Create call log for inbound call
      const callLog = new CallLog({
        leadId: lead._id,
        userId: lead.createdBy,
        agentNumber: called_number,
        destinationNumber: caller_number,
        providerCallId: call_id,
        callStatus: mapSmartfloStatus(call_status),
        callDirection: "inbound",
        startTime: start_time ? new Date(start_time) : new Date(),
        webhookData,
      });

      await callLog.save();

      // Update lead
      lead.lastCallDate = new Date();
      lead.lastCallStatus = "inbound_call";
      await lead.save();

      res.status(200).json({
        success: true,
        message: "Inbound call logged",
        leadId: lead._id,
        leadName: lead.contactName || lead.customerName,
      });
    } else {
      // Unknown caller - could create new lead or just log
      console.log("Inbound call from unknown number:", caller_number);
      
      res.status(200).json({
        success: true,
        message: "Inbound call from unknown number",
      });
    }
  } catch (error) {
    console.error("Inbound webhook error:", error);
    
    res.status(200).json({
      success: false,
      message: "Webhook received but processing failed",
      error: error.message,
    });
  }
};

/**
 * Map Smartflo call status to CRM status
 */
function mapSmartfloStatus(smartfloStatus) {
  const statusMap = {
    "call.initiated": "initiated",
    "call.ringing": "ringing",
    "call.answered": "answered",
    "call.completed": "completed",
    "call.failed": "failed",
    "call.no_answer": "no_answer",
    "call.busy": "busy",
    "call.cancelled": "cancelled",
    // Direct status values
    "initiated": "initiated",
    "ringing": "ringing",
    "answered": "answered",
    "completed": "completed",
    "failed": "failed",
    "no_answer": "no_answer",
    "busy": "busy",
    "cancelled": "cancelled",
  };

  return statusMap[smartfloStatus] || "initiated";
}

/**
 * Verify webhook signature (implement based on Smartflo documentation)
 */
function verifyWebhookSignature(signature, payload) {
  // Implement signature verification if Smartflo provides it
  // const crypto = require('crypto');
  // const secret = process.env.SMARTFLO_WEBHOOK_SECRET;
  // const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  // return hash === signature;
  
  return true; // For now, accept all webhooks
}

module.exports = exports;
