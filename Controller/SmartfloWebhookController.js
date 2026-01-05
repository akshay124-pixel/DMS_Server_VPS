/**
 * Enhanced Smartflo Webhook Controller
 * Handles ALL call events with complete virtual number tracking
 * Supports both incoming and outgoing calls with unified call history
 */

const CallLog = require("../Schema/CallLogModel");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const crypto = require("crypto");
const { smartInvalidate } = require("../Middleware/CacheMiddleware");

/**
 * Handle call event webhooks from Smartflo
 * POST /api/webhooks/smartflo/call-events
 * 
 * Enhanced to handle:
 * - Virtual number tracking
 * - Incoming call routing
 * - Agent assignment
 * - Queue management
 * - Call transfers
 */
exports.handleCallEvents = async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Enhanced webhook logging for debugging
    console.log("📱 WEBHOOK RECEIVED:", {
      headers: {
        signature: req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'],
        contentType: req.headers['content-type'],
        userAgent: req.headers['user-agent']
      },
      body: JSON.stringify(webhookData, null, 2),
      timestamp: new Date().toISOString()
    });
    
    console.log("📱 OUTBOUND WEBHOOK: Processing call event", {
      event_type: webhookData.event_type,
      call_status: webhookData.call_status,
      direction: webhookData.direction,
      timestamp: new Date().toISOString()
    });
    
    // SECURITY: Verify outbound webhook signature
    const signature = req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'];
    if (process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET && signature) {
      if (!verifyOutboundWebhookSignature(signature, webhookData)) {
        console.log("❌ OUTBOUND WEBHOOK: Invalid signature");
        // In development, log but don't reject to help debug signature format
        if (process.env.NODE_ENV === 'production') {
          return res.status(401).json({ success: false, message: 'Invalid outbound webhook signature' });
        } else {
          console.log("⚠️ DEVELOPMENT: Continuing despite invalid signature for debugging");
          console.log("🔍 DEBUG: Raw signature header:", signature);
          console.log("🔍 DEBUG: Webhook secret configured:", process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET ? 'YES' : 'NO');
        }
      } else {
        console.log("✅ OUTBOUND WEBHOOK: Signature verified");
      }
    } else {
      console.log("⚠️ OUTBOUND WEBHOOK: No signature verification (missing secret or signature)");
      if (!process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET) {
        console.log("🔍 DEBUG: SMARTFLO_OUTBOUND_WEBHOOK_SECRET not configured");
      }
      if (!signature) {
        console.log("🔍 DEBUG: No signature header found");
      }
    }

    // Enhanced webhook data extraction
    const {
      call_id,
      custom_identifier,
      event_type,
      call_status,
      agent_number,
      destination_number,
      caller_id,
      virtual_number, // CRITICAL: Virtual number used
      called_number,  // Alternative field name
      start_time,
      end_time,
      duration,
      recording_url,
      disposition,
      direction,
      queue_id,
      queue_wait_time,
      transfer_data,
      ivr_data,
      // Additional fields that might indicate inbound
      call_direction,
      call_type,
      inbound,
    } = webhookData;

    // Determine virtual number from multiple possible fields
    const virtualNum = virtual_number || called_number || agent_number;
    
    // ENHANCED INBOUND DETECTION - Check multiple possible indicators
    const isInbound = 
      direction === "inbound" || direction === "INBOUND" || direction === "Inbound" ||
      call_direction === "inbound" || call_direction === "INBOUND" || call_direction === "Inbound" ||
      call_type === "inbound" || call_type === "INBOUND" || call_type === "Inbound" ||
      event_type?.toLowerCase().includes('inbound') ||
      inbound === true || inbound === "true" ||
      // CRITICAL: If webhook is configured for inbound and we have caller_id, assume inbound
      (caller_id && called_number && !custom_identifier) ||
      // If virtual number is called_number and we have caller_id, it's inbound
      (caller_id && called_number && virtual_number === called_number) ||
      // NEW: Additional detection for Smartflo India format
      (caller_id && !custom_identifier && virtualNum) ||
      // NEW: If we have caller_id but no outbound custom_identifier, it's likely inbound
      (caller_id && !custom_identifier && event_type !== "call.initiated");
    
    // If no call_id, generate one for tracking
    const callId = call_id || `WEBHOOK_${Date.now()}`;
    
    // Find existing call log by provider call ID or custom identifier
    let callLog = null;
    
    // First try to find by provider call ID (most specific)
    if (callId) {
      callLog = await CallLog.findOne({ providerCallId: callId });
    }
    
    // If not found and we have custom identifier, try that (for outbound calls)
    if (!callLog && custom_identifier) {
      callLog = await CallLog.findOne({ customIdentifier: custom_identifier });
    }

    // CRITICAL: For inbound calls, phone to match is caller_id
    // For outbound calls, phone to match is destination_number
    const phoneToMatch = isInbound ? 
      (caller_id || webhookData.caller_id_number || destination_number || webhookData.call_to_number) : 
      (destination_number || webhookData.call_to_number);

    // Determine user/agent for the call early (needed for lead creation)
    let assignedUser = null;
    
    if (isInbound) {
      // For incoming calls, try to find agent by agent_number
      if (agent_number) {
        assignedUser = await User.findOne({ smartfloAgentNumber: agent_number });
      }
    } else {
      // For outbound calls, find user by agent number or custom identifier
      if (agent_number) {
        assignedUser = await User.findOne({ smartfloAgentNumber: agent_number });
      }
      if (!assignedUser && custom_identifier) {
        // Extract user ID from custom identifier if format is CRM_leadId_userId_timestamp
        const parts = custom_identifier.split('_');
        if (parts.length >= 3) {
          assignedUser = await User.findById(parts[2]);
        }
      }
    }

    if (!callLog) {
      // Find lead by phone number (caller for inbound, destination for outbound)
      let lead = await Entry.findOne({ mobileNumber: phoneToMatch });
      
      // For incoming calls from unknown numbers, create a placeholder lead
      if (!lead && isInbound && phoneToMatch) {
        lead = await createLeadForInboundCall(phoneToMatch, assignedUser);
      }
      
      // CRITICAL: For inbound calls, if no lead found, still create one
      if (!lead && isInbound && phoneToMatch) {
        lead = await createLeadForInboundCall(phoneToMatch, assignedUser);
      }
      
      if (!lead) {
        // For inbound calls without phone number, still log the call
        if (isInbound) {
          lead = await createLeadForInboundCall(phoneToMatch || "Unknown", assignedUser);
        } else {
          return res.status(200).json({ 
            success: true, 
            message: "Webhook received but no matching lead",
            action: "ignored"
          });
        }
      }

      // Complete user assignment for inbound calls
      if (isInbound) {
        // Try to find agent by lead creator if not already assigned
        if (!assignedUser && lead.createdBy) {
          assignedUser = await User.findById(lead.createdBy);
        }
        // If still no user, assign to first available admin
        if (!assignedUser) {
          assignedUser = await User.findOne({ role: { $in: ["Admin", "Superadmin"] } });
        }
      }

      if (!assignedUser) {
        assignedUser = await User.findOne({ role: { $in: ["Admin", "Superadmin"] } });
      }

      // Create comprehensive call log
      callLog = new CallLog({
        leadId: lead._id,
        userId: assignedUser ? assignedUser._id : null,
        agentNumber: agent_number || virtualNum,
        destinationNumber: isInbound ? (caller_id || destination_number) : destination_number,
        callerId: caller_id,
        virtualNumber: virtualNum, // CRITICAL: Store virtual number
        providerCallId: callId,
        customIdentifier: custom_identifier,
        callStatus: mapSmartfloStatus(call_status || event_type),
        callDirection: isInbound ? "inbound" : "outbound", // CRITICAL: Set correct direction
        queueId: queue_id,
        queueWaitTime: queue_wait_time ? parseInt(queue_wait_time) : 0,
        assignedAt: isInbound ? new Date() : null,
        routingReason: isInbound ? (queue_id ? "queue" : "direct") : "direct",
        source: "WEBHOOK",
        webhookData,
      });

      // Update lead creator if it was an unknown caller
      if (lead.createdBy === null && assignedUser) {
        lead.createdBy = assignedUser._id;
        await lead.save();
      }
    } else {
      // Update existing call log
      callLog.callStatus = mapSmartfloStatus(call_status || event_type);
      callLog.webhookData = { ...callLog.webhookData, ...webhookData };
      
      // Update virtual number if not set
      if (!callLog.virtualNumber && virtualNum) {
        callLog.virtualNumber = virtualNum;
      }
      
      // Update queue information
      if (queue_id && !callLog.queueId) {
        callLog.queueId = queue_id;
        callLog.queueWaitTime = queue_wait_time ? parseInt(queue_wait_time) : 0;
      }
      
      // CRITICAL: Update direction if it was wrong initially
      if (isInbound && callLog.callDirection !== "inbound") {
        callLog.callDirection = "inbound";
      }
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
      console.log(`✅ Recording URL updated for call ${callId}: ${recording_url ? '[URL_SET]' : '[NO_URL]'}`);
    } else {
      console.log(`⚠️ No recording URL in webhook for call ${callId}`);
    }

    // Update disposition
    if (disposition) {
      callLog.disposition = disposition;
    }

    // Handle transfer data
    if (transfer_data) {
      callLog.transferData = {
        transferredFrom: transfer_data.from_agent,
        transferredTo: transfer_data.to_agent,
        transferReason: transfer_data.reason,
        transferTime: transfer_data.time ? new Date(transfer_data.time) : new Date(),
        transferType: transfer_data.type || "warm",
      };
    }

    // Handle IVR data
    if (ivr_data) {
      callLog.ivrData = {
        menuSelections: ivr_data.menu_selections || [],
        dtmfInputs: ivr_data.dtmf_inputs || [],
        ivrDuration: ivr_data.duration ? parseInt(ivr_data.duration) : 0,
      };
    }

    await callLog.save();
    
    // Recording URL fallback mechanism - fetch recording if missing after call completion
    if (callLog.callStatus === "completed" && !callLog.recordingUrl && callLog.providerCallId) {
      console.log(`⏰ Scheduling recording fetch for completed call ${callLog.providerCallId}`);
      // Schedule recording fetch after delay (recordings might not be ready immediately)
      setTimeout(async () => {
        try {
          const smartfloClient = require('../services/smartfloClient');
          const recordingData = await smartfloClient.getRecordingUrl(callLog.providerCallId);
          if (recordingData && recordingData.recording_url) {
            const updatedCallLog = await CallLog.findById(callLog._id);
            if (updatedCallLog && !updatedCallLog.recordingUrl) {
              updatedCallLog.recordingUrl = recordingData.recording_url;
              await updatedCallLog.save();
              console.log(`✅ Recording URL fetched via API for call ${callLog.providerCallId}`);
            }
          }
        } catch (error) {
          console.error(`❌ Failed to fetch recording for call ${callLog.providerCallId}:`, error.message);
        }
      }, 30000); // Wait 30 seconds for recording to be ready
    }
    
    // SMART CACHE: Invalidate only call-related cache and refresh
    smartInvalidate('calls', callLog.userId?.toString());
    if (process.env.NODE_ENV === 'development') {
      console.log("🧠 SMART CACHE: Invalidated call cache for user");
    }

    // Enhanced lead update logic
    if (callLog.leadId) {
      const lead = await Entry.findById(callLog.leadId);
      if (lead) {
        lead.lastCallDate = new Date();
        lead.lastCallStatus = callLog.callStatus;
        
        // Intelligent lead status updates based on call outcome
        if (callLog.callStatus === "completed") {
          if (callLog.duration > 60) {
            // Meaningful conversation
            if (lead.status === "Not Found") {
              lead.status = "Interested";
            }
          } else if (callLog.duration > 10) {
            // Brief conversation
            if (lead.status === "Not Found") {
              lead.status = "Maybe";
            }
          }
        } else if (callLog.callStatus === "no_answer" || callLog.callStatus === "failed") {
          // Schedule automatic follow-up
          if (!lead.callbackScheduled) {
            const followUpDate = new Date();
            followUpDate.setHours(followUpDate.getHours() + 24); // 24 hours later
            lead.callbackScheduled = followUpDate;
            lead.callbackReason = `Follow-up after ${callLog.callStatus}`;
          }
        }

        // Track call frequency
        if (!lead.totalCallsMade) lead.totalCallsMade = 0;
        lead.totalCallsMade += 1;

        await lead.save();
      }
    }

    // Send success response to Smartflo
    res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      callLogId: callLog._id,
      direction: callLog.callDirection,
      virtualNumber: callLog.virtualNumber,
      leadId: callLog.leadId,
    });
  } catch (error) {
    // Still return 200 to prevent Smartflo from retrying
    res.status(200).json({
      success: false,
      message: "Webhook received but processing failed",
      error: error.message,
    });
  }
};

/**
 * Enhanced inbound call webhook handler
 * POST /api/webhooks/smartflo/inbound
 * 
 * Handles:
 * - Virtual number identification
 * - Unknown caller management
 * - Agent assignment
 * - Lead creation for new callers
 */
exports.handleInboundCall = async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Enhanced webhook logging for debugging
    console.log("📞 INBOUND WEBHOOK RECEIVED:", {
      headers: {
        signature: req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'],
        contentType: req.headers['content-type'],
        userAgent: req.headers['user-agent']
      },
      body: JSON.stringify(webhookData, null, 2),
      timestamp: new Date().toISOString()
    });
    
    // SECURITY: Verify inbound webhook signature
    const signature = req.headers['x-smartflo-signature'] || req.headers['x-smartflo-secret'];
    if (process.env.SMARTFLO_INBOUND_WEBHOOK_SECRET && signature) {
      if (!verifyInboundWebhookSignature(signature, webhookData)) {
        console.log("❌ INBOUND WEBHOOK: Invalid signature");
        // In development, log but don't reject
        if (process.env.NODE_ENV === 'production') {
          return res.status(401).json({ success: false, message: 'Invalid inbound webhook signature' });
        } else {
          console.log("⚠️ DEVELOPMENT: Continuing despite invalid signature");
        }
      } else {
        console.log("✅ INBOUND WEBHOOK: Signature verified");
      }
    } else {
      console.log("⚠️ INBOUND WEBHOOK: No signature verification (missing secret or signature)");
    }

    console.log("📞 INBOUND WEBHOOK: Processing inbound call", {
      call_id: webhookData.call_id,
      caller_number: webhookData.caller_number,
      called_number: webhookData.called_number,
      virtual_number: webhookData.virtual_number,
      timestamp: new Date().toISOString()
    });

    const {
      call_id,
      caller_number,
      called_number, // This is the virtual number
      virtual_number,
      call_status,
      start_time,
      agent_number,
      queue_id,
      queue_wait_time,
    } = webhookData;

    const virtualNum = virtual_number || called_number;
    const callerNum = caller_number;

    // Find existing lead by caller number
    let lead = await Entry.findOne({ mobileNumber: callerNum });
    let isNewLead = false;

    if (!lead) {
      // Create new lead for unknown caller
      lead = new Entry({
        customerName: `Incoming Caller ${callerNum}`,
        mobileNumber: callerNum,
        status: "Not Found",
        organization: "Unknown",
        category: "Incoming Call",
        address: "Unknown",
        state: "Unknown", 
        city: "Unknown",
        source: "INCOMING_CALL",
        createdBy: null, // Will be assigned when agent is determined
      });
      
      await lead.save();
      isNewLead = true;
    }

    // Determine assigned agent
    let assignedUser = null;
    
    if (agent_number) {
      assignedUser = await User.findOne({ smartfloAgentNumber: agent_number });
    }
    
    // If no specific agent, assign to lead creator or first available admin
    if (!assignedUser) {
      if (lead.createdBy) {
        assignedUser = await User.findById(lead.createdBy);
      } else {
        assignedUser = await User.findOne({ role: { $in: ["Admin", "Superadmin"] } });
      }
    }

    // Update lead creator if it was a new lead
    if (isNewLead && assignedUser) {
      lead.createdBy = assignedUser._id;
      await lead.save();
    }

    // Create comprehensive call log for inbound call
    const callLog = new CallLog({
      leadId: lead._id,
      userId: assignedUser ? assignedUser._id : null,
      agentNumber: agent_number || virtualNum,
      destinationNumber: callerNum, // For inbound, destination is the caller
      callerId: callerNum,
      virtualNumber: virtualNum, // CRITICAL: Store which virtual number was called
      providerCallId: call_id,
      callStatus: mapSmartfloStatus(call_status),
      callDirection: "inbound",
      queueId: queue_id,
      queueWaitTime: queue_wait_time ? parseInt(queue_wait_time) : 0,
      assignedAt: new Date(),
      routingReason: queue_id ? "queue" : "direct",
      startTime: start_time ? new Date(start_time) : new Date(),
      source: "WEBHOOK",
      webhookData,
    });

    await callLog.save();
    
    // SMART CACHE: Invalidate call and entry cache for affected user
    smartInvalidate('calls', callLog.userId?.toString());
    if (callLog.leadId) {
      smartInvalidate('entries', callLog.userId?.toString());
    }
    console.log("🧠 SMART CACHE: Invalidated call+entry cache for inbound call");

    // Update lead with inbound call information
    lead.lastCallDate = new Date();
    lead.lastCallStatus = "inbound_call";
    
    // Track inbound call count
    if (!lead.totalInboundCalls) lead.totalInboundCalls = 0;
    lead.totalInboundCalls += 1;
    
    await lead.save();
    
    // SMART CACHE: Final targeted invalidation after all processing
    smartInvalidate('calls', callLog.userId?.toString());
    smartInvalidate('entries', callLog.userId?.toString());
    console.log("🧠 SMART CACHE: Final targeted cache invalidation complete");

    res.status(200).json({
      success: true,
      message: "Inbound call logged successfully",
      callLogId: callLog._id,
      leadId: lead._id,
      leadName: lead.contactName || lead.customerName,
      virtualNumber: virtualNum,
      isNewLead,
      assignedAgent: assignedUser ? assignedUser.username : null,
    });
  } catch (error) {
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
  if (!smartfloStatus) return "initiated";
  
  // Normalize to lowercase for comparison
  const status = smartfloStatus.toLowerCase();
  
  const statusMap = {
    // Standard Smartflo events
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
    
    // Alternative formats Smartflo might use
    "answer": "answered",
    "pickup": "answered",
    "connected": "answered",
    "hangup": "completed",
    "end": "completed",
    "finished": "completed",
    "noanswer": "no_answer",
    "timeout": "no_answer",
    "reject": "failed",
    "error": "failed",
    "declined": "failed",
    "unreachable": "failed",
  };

  const mappedStatus = statusMap[status] || "initiated";
  
  // Log unmapped statuses for debugging
  if (!statusMap[status] && smartfloStatus !== "initiated") {
    console.log(`⚠️ Unknown Smartflo status: "${smartfloStatus}" -> defaulting to "initiated"`);
  }
  
  return mappedStatus;
}

/**
 * Verify webhook signature for outbound calls
 */
function verifyOutboundWebhookSignature(signature, payload) {
  try {
    const secret = process.env.SMARTFLO_OUTBOUND_WEBHOOK_SECRET || process.env.SMARTFLO_WEBHOOK_SECRET;
    if (!secret) return true; // Skip verification if no secret configured
    
    if (!signature) return false;
    
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    
    // Extract hex part from signature (remove sha256= prefix if present)
    const normalizedSignature = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    
    console.log('Signature verification details:', {
      receivedLength: normalizedSignature.length,
      expectedLength: hash.length,
      receivedSig: normalizedSignature.substring(0, 20) + '...',
      expectedSig: hash.substring(0, 20) + '...',
      payloadLength: JSON.stringify(payload).length
    });
    
    // Handle different signature lengths - Smartflo might send truncated signatures
    if (normalizedSignature.length !== hash.length) {
      console.log('⚠️ Signature length mismatch - trying alternative verification methods');
      
      // Try comparing first N characters if received signature is shorter
      if (normalizedSignature.length < hash.length) {
        const truncatedHash = hash.substring(0, normalizedSignature.length);
        console.log('Trying truncated comparison:', {
          received: normalizedSignature,
          truncatedExpected: truncatedHash
        });
        
        if (normalizedSignature === truncatedHash) {
          console.log('✅ Truncated signature match found');
          return true;
        }
      }
      
      // Try different payload serialization methods
      const alternativePayloads = [
        JSON.stringify(payload, null, 0),
        JSON.stringify(payload, null, 2),
        JSON.stringify(payload, Object.keys(payload).sort()),
      ];
      
      for (const altPayload of alternativePayloads) {
        const altHash = crypto.createHmac('sha256', secret).update(altPayload).digest('hex');
        const altTruncated = altHash.substring(0, normalizedSignature.length);
        
        if (normalizedSignature === altTruncated || normalizedSignature === altHash) {
          console.log('✅ Alternative payload serialization match found');
          return true;
        }
      }
      
      console.log('❌ All signature verification methods failed');
      return false;
    }
    
    // Standard comparison for equal length signatures
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch (error) {
    console.error('Outbound webhook signature verification error:', error);
    return false;
  }
}

/**
 * Verify webhook signature for inbound calls
 */
function verifyInboundWebhookSignature(signature, payload) {
  try {
    const secret = process.env.SMARTFLO_INBOUND_WEBHOOK_SECRET || process.env.SMARTFLO_WEBHOOK_SECRET;
    if (!secret) return true; // Skip verification if no secret configured
    
    if (!signature) return false;
    
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    
    // Extract hex part from signature (remove sha256= prefix if present)
    const normalizedSignature = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    
    console.log('Inbound signature verification details:', {
      receivedLength: normalizedSignature.length,
      expectedLength: hash.length,
      receivedSig: normalizedSignature.substring(0, 20) + '...',
      expectedSig: hash.substring(0, 20) + '...'
    });
    
    // Handle different signature lengths - Smartflo might send truncated signatures
    if (normalizedSignature.length !== hash.length) {
      console.log('⚠️ Inbound signature length mismatch - trying alternative verification methods');
      
      // Try comparing first N characters if received signature is shorter
      if (normalizedSignature.length < hash.length) {
        const truncatedHash = hash.substring(0, normalizedSignature.length);
        
        if (normalizedSignature === truncatedHash) {
          console.log('✅ Inbound truncated signature match found');
          return true;
        }
      }
      
      // Try different payload serialization methods
      const alternativePayloads = [
        JSON.stringify(payload, null, 0),
        JSON.stringify(payload, null, 2),
        JSON.stringify(payload, Object.keys(payload).sort()),
      ];
      
      for (const altPayload of alternativePayloads) {
        const altHash = crypto.createHmac('sha256', secret).update(altPayload).digest('hex');
        const altTruncated = altHash.substring(0, normalizedSignature.length);
        
        if (normalizedSignature === altTruncated || normalizedSignature === altHash) {
          console.log('✅ Inbound alternative payload serialization match found');
          return true;
        }
      }
      
      console.log('❌ All inbound signature verification methods failed');
      return false;
    }
    
    // Standard comparison for equal length signatures
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch (error) {
    console.error('Inbound webhook signature verification error:', error);
    return false;
  }
}
   
/**
 * Helper function to create lead for inbound calls
 */
async function createLeadForInboundCall(phoneNumber, assignedUser) {
  // Find a default user to assign as creator (preferably admin)
  let defaultUser = assignedUser;
  
  if (!defaultUser) {
    defaultUser = await User.findOne({ role: { $in: ["Admin", "Superadmin"] } });
  }
  
  if (!defaultUser) {
    defaultUser = await User.findOne();
  }
  
  if (!defaultUser) {
    throw new Error('No users available to assign as lead creator');
  }
  
  const lead = new Entry({
    customerName: phoneNumber === "Unknown" ? `Unknown Inbound Caller` : `Incoming Caller ${phoneNumber}`,
    mobileNumber: phoneNumber,
    status: "Not Found",
    organization: "Unknown",
    category: "Incoming Call",
    address: "Unknown",
    state: "Unknown",
    city: "Unknown",
    createdBy: defaultUser._id, // CRITICAL: Set createdBy
    source: "INCOMING_CALL",
  });
  
  await lead.save();
  return lead;
}

module.exports = exports;
