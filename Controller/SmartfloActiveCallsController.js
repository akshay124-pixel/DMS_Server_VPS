const smartfloClient = require("../services/smartfloClient");
const CallLog = require("../Schema/CallLogModel");

/**
 * Smartflo Active Calls Controller
 * Handles real-time active call monitoring and call control operations
 */

/**
 * Get all active calls
 * GET /api/calls/active
 */
exports.getActiveCalls = async (req, res) => {
  try {
    const currentUser = req.user;
    
    // Fetch active calls from Smartflo
    const activeCallsResponse = await smartfloClient.getActiveCalls();
    
    let activeCalls = activeCallsResponse.data || activeCallsResponse.calls || [];
    
    // Filter based on user role
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      // Normal users only see their own calls
      activeCalls = activeCalls.filter(
        (call) => call.agent_number === currentUser.smartfloAgentNumber
      );
    }
    
    // Enrich with CRM data
    const enrichedCalls = await Promise.all(
      activeCalls.map(async (call) => {
        // Try to find matching call log
        const callLog = await CallLog.findOne({
          providerCallId: call.call_id || call.id,
        })
          .populate("leadId", "customerName contactName mobileNumber email")
          .populate("userId", "username email")
          .lean();
        
        return {
          ...call,
          crmData: callLog || null,
        };
      })
    );
    
    res.status(200).json({
      success: true,
      data: enrichedCalls,
      total: enrichedCalls.length,
    });
  } catch (error) {
    console.error("Get active calls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch active calls",
      error: error.message,
    });
  }
};

/**
 * Hangup an active call
 * POST /api/calls/:callId/hangup
 */
exports.hangupCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const currentUser = req.user;
    
    // Find call log to verify ownership
    const callLog = await CallLog.findOne({ providerCallId: callId });
    
    if (callLog) {
      // RBAC: Check if user has permission to hangup
      if (
        currentUser.role !== "Admin" &&
        currentUser.role !== "Superadmin" &&
        callLog.userId.toString() !== currentUser.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only hangup your own calls.",
        });
      }
    }
    
    // Call Smartflo API to hangup
    const result = await smartfloClient.hangupCall(callId);
    
    // Update call log status
    if (callLog) {
      callLog.callStatus = "cancelled";
      callLog.endTime = new Date();
      await callLog.save();
    }
    
    res.status(200).json({
      success: true,
      message: "Call hangup initiated",
      data: result,
    });
  } catch (error) {
    console.error("Hangup call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to hangup call",
      error: error.message,
    });
  }
};

/**
 * Transfer an active call
 * POST /api/calls/:callId/transfer
 */
exports.transferCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const { transferTo, transferType = "blind" } = req.body;
    const currentUser = req.user;
    
    if (!transferTo) {
      return res.status(400).json({
        success: false,
        message: "Transfer destination is required",
      });
    }
    
    // Find call log to verify ownership
    const callLog = await CallLog.findOne({ providerCallId: callId });
    
    if (callLog) {
      // RBAC check
      if (
        currentUser.role !== "Admin" &&
        currentUser.role !== "Superadmin" &&
        callLog.userId.toString() !== currentUser.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }
    
    // Call Smartflo API to transfer
    const result = await smartfloClient.transferCall(callId, transferTo, transferType);
    
    res.status(200).json({
      success: true,
      message: "Call transfer initiated",
      data: result,
    });
  } catch (error) {
    console.error("Transfer call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to transfer call",
      error: error.message,
    });
  }
};

/**
 * Hold/Unhold an active call
 * POST /api/calls/:callId/hold
 */
exports.holdCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const { action = "hold" } = req.body; // hold or unhold
    const currentUser = req.user;
    
    // Find call log to verify ownership
    const callLog = await CallLog.findOne({ providerCallId: callId });
    
    if (callLog) {
      // RBAC check
      if (
        currentUser.role !== "Admin" &&
        currentUser.role !== "Superadmin" &&
        callLog.userId.toString() !== currentUser.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }
    
    // Call Smartflo API
    const result = await smartfloClient.holdCall(callId, action);
    
    res.status(200).json({
      success: true,
      message: `Call ${action} successful`,
      data: result,
    });
  } catch (error) {
    console.error("Hold call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to hold/unhold call",
      error: error.message,
    });
  }
};

/**
 * Get call status
 * GET /api/calls/:callId/status
 */
exports.getCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;
    
    // Try to get from local database first
    const callLog = await CallLog.findOne({ providerCallId: callId })
      .populate("leadId", "customerName contactName mobileNumber")
      .populate("userId", "username email")
      .lean();
    
    if (callLog) {
      return res.status(200).json({
        success: true,
        data: {
          ...callLog,
          source: "database",
        },
      });
    }
    
    // If not found locally, fetch from Smartflo
    const smartfloStatus = await smartfloClient.getCallStatus(callId);
    
    res.status(200).json({
      success: true,
      data: {
        ...smartfloStatus,
        source: "smartflo",
      },
    });
  } catch (error) {
    console.error("Get call status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call status",
      error: error.message,
    });
  }
};

module.exports = exports;
