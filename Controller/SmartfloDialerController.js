const CallLog = require("../Schema/CallLogModel");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const ScheduledCall = require("../Schema/ScheduledCallModel");
const smartfloClient = require("../services/smartfloClient");

/**
 * Smartflo Dialer Controller
 * Handles click-to-call, call logging, callback scheduling, and scheduled calls
 */

/**
 * Initiate click-to-call
 * POST /api/dialer/click-to-call
 */
exports.clickToCall = async (req, res) => {
  try {
    const { leadId } = req.body;
    const userId = req.user.id;

    // 1) Lead validate
    const lead = await Entry.findById(leadId);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (!lead.mobileNumber) {
      return res.status(400).json({
        success: false,
        message: "Lead does not have a phone number",
      });
    }

    // 2) User validate
    const user = await User.findById(userId);
    if (!user || !user.smartfloEnabled || !user.smartfloAgentNumber) {
      return res.status(400).json({
        success: false,
        message: "User is not mapped to Smartflo agent. Please contact administrator.",
      });
    }

    if (!process.env.SMARTFLO_DEFAULT_CALLER_ID) {
      return res.status(500).json({
        success: false,
        message: "SMARTFLO_DEFAULT_CALLER_ID is not configured on server",
      });
    }

    const customIdentifier = `CRM_${leadId}_${Date.now()}`;

    // 3) Smartflo API call
    const payload = {
      agentNumber: user.smartfloAgentNumber,
      destinationNumber: lead.mobileNumber,
      callerId: process.env.SMARTFLO_DEFAULT_CALLER_ID,
      customIdentifier,
    };

    console.log("ClickToCall payload", {
      agentNumber: payload.agentNumber,
      destinationNumber: payload.destinationNumber,
      callerId: payload.callerId,
      customIdentifier,
    });
    const callResponse = await smartfloClient.clickToCall(payload);
    console.log("ClickToCall response", callResponse);

    // 4) Call log save
    const callLog = new CallLog({
      leadId: lead._id,
      userId: user._id,
      agentNumber: user.smartfloAgentNumber,
      destinationNumber: lead.mobileNumber,
      callerId: process.env.SMARTFLO_DEFAULT_CALLER_ID,
      providerCallId: callResponse.call_id || callResponse.id,
      customIdentifier,
      callStatus: "initiated",
      callDirection: "outbound",
    });

    await callLog.save();

    lead.totalCallsMade = (lead.totalCallsMade || 0) + 1;
    lead.lastCallDate = new Date();
    lead.lastCallStatus = "initiated";
    await lead.save();

    return res.status(200).json({
      success: true,
      message: "Call initiated successfully",
      callLogId: callLog._id,
      providerCallId: callLog.providerCallId,
      customIdentifier,
    });
  } catch (error) {
    console.error(
      "Click-to-call error:",
      error.response?.data || error.message || error
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Failed to initiate call",
      providerError: error.response?.data || null,
      error: error.message,
      code: error.code || null,
    });
  }
};



/**
 * Get call logs with filters
 * GET /api/dialer/call-logs
 */
exports.getCallLogs = async (req, res) => {
  try {
    const { leadId, userId, status, startDate, endDate, page = 1, limit = 50 } = req.query;

    // Build filter
    const filter = {};
    if (leadId) filter.leadId = leadId;
    if (userId) filter.userId = userId;
    if (status) filter.callStatus = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch call logs
    const callLogs = await CallLog.find(filter)
      .populate("leadId", "customerName contactName mobileNumber email")
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CallLog.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: callLogs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get call logs error:", error);
    res.status(500).json({
      message: "Failed to fetch call logs",
      error: error.message,
    });
  }
};

/**
 * Get call history for specific lead
 * GET /api/dialer/call-logs/:leadId
 */
exports.getLeadCallHistory = async (req, res) => {
  try {
    const { leadId } = req.params;

    const callLogs = await CallLog.find({ leadId })
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .limit(100);

    res.status(200).json({
      success: true,
      data: callLogs,
      total: callLogs.length,
    });
  } catch (error) {
    console.error("Get lead call history error:", error);
    res.status(500).json({
      message: "Failed to fetch call history",
      error: error.message,
    });
  }
};

/**
 * Manually log a call (for offline calls)
 * POST /api/dialer/manual-log
 */
exports.manualCallLog = async (req, res) => {
  try {
    const { leadId, duration, disposition, remarks, callStatus } = req.body;
    const userId = req.user.id;

    // Validate lead exists
    const lead = await Entry.findById(leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    // Get user
    const user = await User.findById(userId);

    // Create manual call log
    const callLog = new CallLog({
      leadId: lead._id,
      userId: user._id,
      agentNumber: user.smartfloAgentNumber || "manual",
      destinationNumber: lead.mobileNumber,
      callStatus: callStatus || "completed",
      callDirection: "outbound",
      duration: duration || 0,
      disposition,
      remarks,
      startTime: new Date(),
      endTime: new Date(),
    });

    await callLog.save();

    // Update lead statistics
    lead.totalCallsMade = (lead.totalCallsMade || 0) + 1;
    lead.lastCallDate = new Date();
    lead.lastCallStatus = callStatus || "completed";
    await lead.save();

    res.status(200).json({
      success: true,
      message: "Call logged successfully",
      callLogId: callLog._id,
    });
  } catch (error) {
    console.error("Manual call log error:", error);
    res.status(500).json({
      message: "Failed to log call",
      error: error.message,
    });
  }
};

/**
 * Schedule a future call
 * POST /api/dialer/schedule-call
 */
exports.scheduleCall = async (req, res) => {
  try {
    const { leadId, scheduledTime, priority, purpose, notes } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!leadId || !scheduledTime || !purpose) {
      return res.status(400).json({ 
        success: false,
        message: "Lead ID, scheduled time, and purpose are required" 
      });
    }

    // Validate scheduled time is in the future
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Scheduled time must be in the future"
      });
    }

    // Validate lead exists
    const lead = await Entry.findById(leadId);
    if (!lead) {
      return res.status(404).json({ 
        success: false,
        message: "Lead not found" 
      });
    }

    // Create scheduled call
    const scheduledCall = new ScheduledCall({
      leadId,
      userId,
      scheduledTime: scheduledDate,
      priority: priority || "medium",
      purpose,
      notes: notes || "",
      status: "pending",
    });

    await scheduledCall.save();

    // Populate lead and user details
    await scheduledCall.populate("leadId", "customerName contactName mobileNumber email");
    await scheduledCall.populate("userId", "username email");

    res.status(201).json({
      success: true,
      message: "Call scheduled successfully",
      data: scheduledCall,
    });
  } catch (error) {
    console.error("Schedule call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to schedule call",
      error: error.message,
    });
  }
};

/**
 * Get all scheduled calls for current user (or all if admin)
 * GET /api/dialer/scheduled-calls
 */
exports.getScheduledCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, priority, purpose, startDate, endDate } = req.query;

    // Build filter
    const filter = {};
    
    // Non-admin users can only see their own scheduled calls
    if (userRole !== "Admin" && userRole !== "Superadmin") {
      filter.userId = userId;
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (purpose) filter.purpose = purpose;
    
    if (startDate || endDate) {
      filter.scheduledTime = {};
      if (startDate) filter.scheduledTime.$gte = new Date(startDate);
      if (endDate) filter.scheduledTime.$lte = new Date(endDate);
    }

    // Fetch scheduled calls
    const scheduledCalls = await ScheduledCall.find(filter)
      .populate("leadId", "customerName contactName mobileNumber email")
      .populate("userId", "username email")
      .sort({ scheduledTime: 1 });

    res.status(200).json({
      success: true,
      data: scheduledCalls,
      total: scheduledCalls.length,
    });
  } catch (error) {
    console.error("Get scheduled calls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch scheduled calls",
      error: error.message,
    });
  }
};

/**
 * Get scheduled calls for a specific lead
 * GET /api/dialer/scheduled-calls/:leadId
 */
exports.getLeadScheduledCalls = async (req, res) => {
  try {
    const { leadId } = req.params;

    const scheduledCalls = await ScheduledCall.find({ leadId })
      .populate("userId", "username email")
      .sort({ scheduledTime: -1 });

    res.status(200).json({
      success: true,
      data: scheduledCalls,
      total: scheduledCalls.length,
    });
  } catch (error) {
    console.error("Get lead scheduled calls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch scheduled calls",
      error: error.message,
    });
  }
};

/**
 * Update a scheduled call
 * PATCH /api/dialer/scheduled-calls/:id
 */
exports.updateScheduledCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledTime, priority, purpose, notes } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const scheduledCall = await ScheduledCall.findById(id);
    
    if (!scheduledCall) {
      return res.status(404).json({
        success: false,
        message: "Scheduled call not found"
      });
    }

    // Check ownership (unless admin)
    if (userRole !== "Admin" && userRole !== "Superadmin" && 
        scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this scheduled call"
      });
    }

    // Update fields
    if (scheduledTime) {
      const newScheduledDate = new Date(scheduledTime);
      if (newScheduledDate <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Scheduled time must be in the future"
        });
      }
      scheduledCall.scheduledTime = newScheduledDate;
    }
    
    if (priority) scheduledCall.priority = priority;
    if (purpose) scheduledCall.purpose = purpose;
    if (notes !== undefined) scheduledCall.notes = notes;

    await scheduledCall.save();
    await scheduledCall.populate("leadId", "customerName contactName mobileNumber email");
    await scheduledCall.populate("userId", "username email");

    res.status(200).json({
      success: true,
      message: "Scheduled call updated successfully",
      data: scheduledCall,
    });
  } catch (error) {
    console.error("Update scheduled call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update scheduled call",
      error: error.message,
    });
  }
};

/**
 * Mark scheduled call as completed
 * PATCH /api/dialer/scheduled-calls/:id/complete
 */
exports.completeScheduledCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, outcome } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const scheduledCall = await ScheduledCall.findById(id);
    
    if (!scheduledCall) {
      return res.status(404).json({
        success: false,
        message: "Scheduled call not found"
      });
    }

    // Check ownership (unless admin)
    if (userRole !== "Admin" && userRole !== "Superadmin" && 
        scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this scheduled call"
      });
    }

    await scheduledCall.markCompleted(notes, outcome);
    await scheduledCall.populate("leadId", "customerName contactName mobileNumber email");
    await scheduledCall.populate("userId", "username email");

    res.status(200).json({
      success: true,
      message: "Scheduled call marked as completed",
      data: scheduledCall,
    });
  } catch (error) {
    console.error("Complete scheduled call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete scheduled call",
      error: error.message,
    });
  }
};

/**
 * Delete a scheduled call
 * DELETE /api/dialer/scheduled-calls/:id
 */
exports.deleteScheduledCall = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const scheduledCall = await ScheduledCall.findById(id);
    
    if (!scheduledCall) {
      return res.status(404).json({
        success: false,
        message: "Scheduled call not found"
      });
    }

    // Check ownership (unless admin)
    if (userRole !== "Admin" && userRole !== "Superadmin" && 
        scheduledCall.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this scheduled call"
      });
    }

    await ScheduledCall.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Scheduled call deleted successfully",
    });
  } catch (error) {
    console.error("Delete scheduled call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete scheduled call",
      error: error.message,
    });
  }
};

/**
 * Get upcoming scheduled calls (next 24 hours)
 * GET /api/dialer/scheduled-calls/upcoming/today
 */
exports.getUpcomingCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const hours = parseInt(req.query.hours) || 24;

    const upcomingCalls = await ScheduledCall.findUpcoming(userId, hours);
    
    // Populate details
    await ScheduledCall.populate(upcomingCalls, [
      { path: "leadId", select: "customerName contactName mobileNumber email" },
      { path: "userId", select: "username email" }
    ]);

    res.status(200).json({
      success: true,
      data: upcomingCalls,
      total: upcomingCalls.length,
    });
  } catch (error) {
    console.error("Get upcoming calls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch upcoming calls",
      error: error.message,
    });
  }
};

/**
 * Get overdue scheduled calls
 * GET /api/dialer/scheduled-calls/overdue
 */
exports.getOverdueCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const filter = {
      status: "pending",
      scheduledTime: { $lt: new Date() },
    };

    // Non-admin users can only see their own overdue calls
    if (userRole !== "Admin" && userRole !== "Superadmin") {
      filter.userId = userId;
    }

    const overdueCalls = await ScheduledCall.find(filter)
      .populate("leadId", "customerName contactName mobileNumber email")
      .populate("userId", "username email")
      .sort({ scheduledTime: 1 });

    res.status(200).json({
      success: true,
      data: overdueCalls,
      total: overdueCalls.length,
    });
  } catch (error) {
    console.error("Get overdue calls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch overdue calls",
      error: error.message,
    });
  }
};

/**
 * Get scheduled calls statistics
 * GET /api/dialer/scheduled-calls/stats
 */
exports.getScheduledCallsStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const filter = {};
    if (userRole !== "Admin" && userRole !== "Superadmin") {
      filter.userId = userId;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalPending,
      todayCalls,
      highPriority,
      overdue,
      completed,
      missed,
    ] = await Promise.all([
      ScheduledCall.countDocuments({ ...filter, status: "pending" }),
      ScheduledCall.countDocuments({
        ...filter,
        status: "pending",
        scheduledTime: { $gte: today, $lt: tomorrow },
      }),
      ScheduledCall.countDocuments({
        ...filter,
        status: "pending",
        priority: { $in: ["high", "urgent"] },
      }),
      ScheduledCall.countDocuments({
        ...filter,
        status: "pending",
        scheduledTime: { $lt: now },
      }),
      ScheduledCall.countDocuments({ ...filter, status: "completed" }),
      ScheduledCall.countDocuments({ ...filter, status: "missed" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalPending,
        todayCalls,
        highPriority,
        overdue,
        completed,
        missed,
      },
    });
  } catch (error) {
    console.error("Get scheduled calls stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message,
    });
  }
};
