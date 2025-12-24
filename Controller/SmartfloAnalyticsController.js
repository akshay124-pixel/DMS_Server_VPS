const CallLog = require("../Schema/CallLogModel");
const User = require("../Schema/Model");
const smartfloClient = require("../services/smartfloClient");
const mongoose = require("mongoose");

/**
 * Smartflo Analytics Controller
 * Handles call analytics, agent performance, and CDR synchronization
 */

/**
 * Get call summary statistics
 * GET /api/analytics/call-summary
 */
exports.getCallSummary = async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const currentUser = req.user;

    // Build date filter
    const dateFilter = {};
    
    // RBAC - Role-based access control
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      // For "Others" role, only show their own calls
      // Convert string ID to ObjectId for proper MongoDB comparison
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    } else if (userId) {
      // For Admin/Superadmin, allow filtering by specific user
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
    }
    
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = end;
      }
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    // Aggregate call statistics
    const stats = await CallLog.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "completed"] }, 1, 0] },
          },
          answeredCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "answered"] }, 1, 0] },
          },
          failedCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "failed"] }, 1, 0] },
          },
          noAnswerCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "no_answer"] }, 1, 0] },
          },
          totalDuration: { $sum: "$duration" },
          avgDuration: { $avg: "$duration" },
        },
      },
    ]);

    const summary = stats[0] || {
      totalCalls: 0,
      completedCalls: 0,
      answeredCalls: 0,
      failedCalls: 0,
      noAnswerCalls: 0,
      totalDuration: 0,
      avgDuration: 0,
    };

    // Calculate connection rate
    summary.connectionRate =
      summary.totalCalls > 0
        ? ((summary.completedCalls / summary.totalCalls) * 100).toFixed(2)
        : 0;

    // Format durations
    summary.totalDurationFormatted = formatDuration(summary.totalDuration);
    summary.avgDurationFormatted = formatDuration(summary.avgDuration);

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Get call summary error:", error);
    res.status(500).json({
      message: "Failed to fetch call summary",
      error: error.message,
    });
  }
};

/**
 * Get agent performance metrics
 * GET /api/analytics/agent-performance
 */
exports.getAgentPerformance = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const currentUser = req.user;

    // Build date filter
    const dateFilter = {};
    
    // RBAC - Role-based access control
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      // For "Others" role, only show their own performance
      // Convert string ID to ObjectId for proper MongoDB comparison
      dateFilter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    }
    
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = end;
      }
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    // Aggregate by agent
    const agentStats = await CallLog.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: "$userId",
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "completed"] }, 1, 0] },
          },
          totalDuration: { $sum: "$duration" },
          avgDuration: { $avg: "$duration" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          userId: "$_id",
          username: "$user.username",
          email: "$user.email",
          totalCalls: 1,
          completedCalls: 1,
          totalDuration: 1,
          avgDuration: 1,
          connectionRate: {
            $cond: [
              { $gt: ["$totalCalls", 0] },
              { $multiply: [{ $divide: ["$completedCalls", "$totalCalls"] }, 100] },
              0,
            ],
          },
        },
      },
      { $sort: { totalCalls: -1 } },
    ]);

    // Format durations
    agentStats.forEach((agent) => {
      agent.totalDurationFormatted = formatDuration(agent.totalDuration);
      agent.avgDurationFormatted = formatDuration(agent.avgDuration);
      agent.connectionRate = agent.connectionRate.toFixed(2);
    });

    res.status(200).json({
      success: true,
      data: agentStats,
    });
  } catch (error) {
    console.error("Get agent performance error:", error);
    res.status(500).json({
      message: "Failed to fetch agent performance",
      error: error.message,
    });
  }
};

/**
 * Sync CDR from Smartflo
 * POST /api/analytics/sync-cdr
 */
exports.syncCDR = async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;

    // Validate admin role
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    // Default to yesterday if no dates provided
    const from = fromDate || getYesterdayDate();
    const to = toDate || getTodayDate();

    console.log(`Syncing CDR from ${from} to ${to}`);

    // Fetch CDR from Smartflo
    const cdrResponse = await smartfloClient.fetchCDR(from, to);
    const cdrRecords = cdrResponse.data || cdrResponse.records || [];

    let updatedCount = 0;
    let newCount = 0;

    // Process each CDR record
    for (const record of cdrRecords) {
      try {
        // Find existing call log
        const callLog = await CallLog.findOne({
          providerCallId: record.call_id || record.id,
        });

        if (callLog) {
          // Update existing record
          callLog.callStatus = mapCDRStatus(record.status);
          callLog.duration = record.duration || callLog.duration;
          callLog.recordingUrl = record.recording_url || callLog.recordingUrl;
          callLog.disposition = record.disposition || callLog.disposition;
          callLog.endTime = record.end_time ? new Date(record.end_time) : callLog.endTime;
          
          await callLog.save();
          updatedCount++;
        } else {
          // Create new record (for calls not initiated via CRM)
          newCount++;
          // Optionally create new CallLog entries
        }
      } catch (error) {
        console.error(`Failed to process CDR record:`, error.message);
      }
    }

    res.status(200).json({
      success: true,
      message: "CDR sync completed",
      data: {
        totalRecords: cdrRecords.length,
        updatedCount,
        newCount,
        dateRange: { from, to },
      },
    });
  } catch (error) {
    console.error("CDR sync error:", error);
    res.status(500).json({
      message: "Failed to sync CDR",
      error: error.message,
    });
  }
};

/**
 * Get daily call trends
 * GET /api/analytics/call-trends
 */
exports.getCallTrends = async (req, res) => {
  try {
    const { days = 30, startDate: queryStartDate, endDate: queryEndDate } = req.query;
    const currentUser = req.user;

    // Build filter
    const filter = {};
    
    // RBAC - Role-based access control
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      // For "Others" role, only show their own calls
      // Convert string ID to ObjectId for proper MongoDB comparison
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
    }

    // Date range
    if (queryStartDate || queryEndDate) {
      filter.createdAt = {};
      if (queryStartDate) filter.createdAt.$gte = new Date(queryStartDate);
      if (queryEndDate) {
        const end = new Date(queryEndDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    } else {
      // Default to last N days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      filter.createdAt = { $gte: startDate };
    }

    const trends = await CallLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "completed"] }, 1, 0] },
          },
          totalDuration: { $sum: "$duration" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      data: trends,
    });
  } catch (error) {
    console.error("Get call trends error:", error);
    res.status(500).json({
      message: "Failed to fetch call trends",
      error: error.message,
    });
  }
};

/**
 * Helper: Format duration in seconds to HH:MM:SS
 */
function formatDuration(seconds) {
  if (!seconds) return "00:00:00";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Helper: Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

/**
 * Helper: Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Helper: Map CDR status to CallLog status
 */
function mapCDRStatus(status) {
  const statusMap = {
    completed: "completed",
    answered: "answered",
    failed: "failed",
    "no-answer": "no_answer",
    busy: "busy",
    cancelled: "cancelled",
  };
  
  return statusMap[status] || status;
}

module.exports = exports;
