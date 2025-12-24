const mongoose = require("mongoose");
const CallLog = require("../Schema/CallLogModel");
const Recording = require("../Schema/RecordingModel");
const User = require("../Schema/Model");
const smartfloClient = require("../services/smartfloClient");
const { Parser } = require("json2csv");
const axios = require("axios");

/**
 * Smartflo Call History Controller
 * Handles call history retrieval, filtering, pagination, and recording access
 */

/**
 * Get call history with advanced filters and pagination
 * GET /api/calls
 */
exports.getCallHistory = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      userId,
      leadId,
      status,
      direction,
      startDate,
      endDate,
      agentNumber,
      destinationNumber,
      hasRecording,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const currentUser = req.user;
    
    console.log("📞 getCallHistory - User:", currentUser.id, "Role:", currentUser.role);
    
    // Build filter based on user role
    const filter = {};
    
    // RBAC: Normal users can only see their own calls - Convert string ID to ObjectId
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
      console.log("🔒 RBAC Filter Applied - userId:", filter.userId);
    } else if (userId) {
      // Admin can filter by specific user
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
      console.log("👤 Admin Filter - userId:", filter.userId);
    }
    
    // Apply filters
    if (leadId) filter.leadId = leadId;
    if (status) filter.callStatus = status;
    if (direction) filter.callDirection = direction;
    if (agentNumber) filter.agentNumber = new RegExp(agentNumber, "i");
    if (destinationNumber) filter.destinationNumber = new RegExp(destinationNumber, "i");
    
    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    
    // Recording filter
    if (hasRecording === "true") {
      filter.recordingUrl = { $exists: true, $ne: null };
    }
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;
    
    // Execute query with population
    const [calls, total] = await Promise.all([
      CallLog.find(filter)
        .populate("leadId", "customerName contactName mobileNumber email organization")
        .populate("userId", "username email smartfloAgentNumber")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      CallLog.countDocuments(filter),
    ]);
    
    // Add recording status to each call
    const callsWithRecordings = await Promise.all(
      calls.map(async (call) => {
        if (call.recordingUrl) {
          const recording = await Recording.findOne({ callLogId: call._id });
          call.recording = recording ? {
            id: recording._id,
            status: recording.status,
            duration: recording.duration,
            format: recording.format,
          } : null;
        }
        return call;
      })
    );
    
    res.status(200).json({
      success: true,
      data: callsWithRecordings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
        hasMore: skip + calls.length < total,
      },
    });
  } catch (error) {
    console.error("Get call history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call history",
      error: error.message,
    });
  }
};

/**
 * Get single call details
 * GET /api/calls/:id
 */
exports.getCallDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    
    const call = await CallLog.findById(id)
      .populate("leadId")
      .populate("userId", "username email smartfloAgentNumber")
      .lean();
    
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }
    
    // RBAC: Check access permission
    if (
      currentUser.role !== "Admin" &&
      currentUser.role !== "Superadmin" &&
      call.userId._id.toString() !== currentUser.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }
    
    // Get recording details if available
    if (call.recordingUrl) {
      const recording = await Recording.findOne({ callLogId: call._id });
      call.recording = recording;
    }
    
    res.status(200).json({
      success: true,
      data: call,
    });
  } catch (error) {
    console.error("Get call details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call details",
      error: error.message,
    });
  }
};

/**
 * Stream/proxy call recording with format conversion
 * GET /api/recordings/:id/stream
 */
exports.streamRecording = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'auto' } = req.query; // auto, mp3, wav
    const currentUser = req.user;
    
    // Find call log
    const call = await CallLog.findById(id);
    
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }
    
    // RBAC: Check access permission
    if (
      currentUser.role !== "Admin" &&
      currentUser.role !== "Superadmin" &&
      call.userId.toString() !== currentUser.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }
    
    if (!call.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available",
      });
    }
    
    // Get or create recording entry
    let recording = await Recording.findOne({ callLogId: call._id });
    
    if (!recording) {
      recording = new Recording({
        callLogId: call._id,
        recordingUrl: call.recordingUrl,
        status: "available",
        duration: call.duration,
      });
      await recording.save();
    }
    
    // Check if URL is expired and needs refresh
    if (recording.isUrlExpired()) {
      // Fetch fresh URL from Smartflo if needed
      // For now, use the existing URL
      console.warn("Recording URL may be expired");
    }
    
    // Record access
    await recording.recordAccess();
    
    // Stream recording through proxy with enhanced error handling
    try {
      console.log("🎵 Streaming recording from:", call.recordingUrl);
      
      const response = await axios({
        method: "GET",
        url: call.recordingUrl,
        responseType: "stream",
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'audio/*,*/*;q=0.9',
        },
      });
      
      console.log("🎵 Original response headers:", response.headers);
      
      // Determine content type
      let contentType = response.headers["content-type"] || "audio/mpeg";
      
      // Normalize content type for better browser compatibility
      if (contentType.includes('audio/mp3') || contentType.includes('audio/x-mpeg')) {
        contentType = "audio/mpeg";
      } else if (contentType.includes('audio/wav')) {
        contentType = "audio/wav";
      } else if (!contentType.startsWith('audio/')) {
        // Default to MP3 if not recognized as audio
        contentType = "audio/mpeg";
      }
      
      console.log("🎵 Normalized content type:", contentType);
      
      // Set appropriate headers for better browser compatibility
      res.setHeader("Content-Type", contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Range");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
      
      // Set content length if available
      if (response.headers["content-length"]) {
        res.setHeader("Content-Length", response.headers["content-length"]);
      }
      
      // Handle range requests for better audio seeking
      const range = req.headers.range;
      if (range && response.headers["content-length"]) {
        const contentLength = parseInt(response.headers["content-length"]);
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : contentLength - 1;
        
        if (start < contentLength) {
          res.status(206);
          res.setHeader("Content-Range", `bytes ${start}-${end}/${contentLength}`);
          res.setHeader("Content-Length", end - start + 1);
        }
      }
      
      // Pipe the stream with error handling
      response.data.on('error', (streamError) => {
        console.error("🎵 Stream pipe error:", streamError);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "Stream interrupted",
            error: streamError.message,
          });
        }
      });
      
      response.data.pipe(res);
      
    } catch (streamError) {
      console.error("Recording stream error:", streamError);
      
      // Update recording status
      recording.status = "failed";
      await recording.save();
      
      // Provide more specific error messages
      let errorMessage = "Failed to stream recording";
      if (streamError.code === 'ENOTFOUND') {
        errorMessage = "Recording server not reachable";
      } else if (streamError.code === 'ETIMEDOUT') {
        errorMessage = "Recording download timeout";
      } else if (streamError.response?.status === 404) {
        errorMessage = "Recording not found on server";
      } else if (streamError.response?.status === 403) {
        errorMessage = "Recording access denied - token may be expired";
      }
      
      return res.status(500).json({
        success: false,
        message: errorMessage,
        error: streamError.message,
        code: streamError.code,
        status: streamError.response?.status,
      });
    }
  } catch (error) {
    console.error("Stream recording error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to access recording",
      error: error.message,
    });
  }
};

/**
 * Get recording metadata with enhanced format detection
 * GET /api/recordings/:id
 */
exports.getRecordingMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    
    const call = await CallLog.findById(id);
    
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }
    
    // RBAC check
    if (
      currentUser.role !== "Admin" &&
      currentUser.role !== "Superadmin" &&
      call.userId.toString() !== currentUser.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }
    
    if (!call.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call",
      });
    }
    
    let recording = await Recording.findOne({ callLogId: call._id });
    
    if (!recording) {
      // Create recording entry with enhanced metadata
      recording = new Recording({
        callLogId: call._id,
        recordingUrl: call.recordingUrl,
        status: "available",
        duration: call.duration,
        format: "mp3", // Default format
        fileSize: null,
        lastAccessed: null,
      });
      
      // Try to get additional metadata from the source
      try {
        const headResponse = await axios.head(call.recordingUrl, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        // Extract metadata from headers
        if (headResponse.headers['content-length']) {
          recording.fileSize = parseInt(headResponse.headers['content-length']);
        }
        
        if (headResponse.headers['content-type']) {
          const contentType = headResponse.headers['content-type'];
          if (contentType.includes('wav')) {
            recording.format = 'wav';
          } else if (contentType.includes('ogg')) {
            recording.format = 'ogg';
          } else if (contentType.includes('mp4')) {
            recording.format = 'mp4';
          } else {
            recording.format = 'mp3'; // Default
          }
        }
        
        console.log("🎵 Recording metadata detected:", {
          format: recording.format,
          fileSize: recording.fileSize,
          contentType: headResponse.headers['content-type']
        });
        
      } catch (metadataError) {
        console.warn("🎵 Could not fetch recording metadata:", metadataError.message);
        // Continue with defaults
      }
      
      await recording.save();
    }
    
    // Enhance response with additional info
    const responseData = {
      ...recording.toObject(),
      callDetails: {
        id: call._id,
        customerName: call.leadId?.customerName || call.leadId?.contactName,
        destinationNumber: call.destinationNumber,
        duration: call.duration,
        callStatus: call.callStatus,
        createdAt: call.createdAt,
      },
      streamUrl: `/api/recordings/${call._id}/stream`,
      directUrl: call.recordingUrl,
      isExpired: recording.isUrlExpired ? recording.isUrlExpired() : false,
      browserCompatibility: {
        mp3: true,
        wav: true,
        ogg: false, // Generally not supported in all browsers
        mp4: true,
      },
      recommendedFormat: 'mp3', // Most compatible
    };
    
    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("Get recording metadata error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recording metadata",
      error: error.message,
    });
  }
};

/**
 * Export call history to CSV
 * POST /api/calls/export
 */
exports.exportCallHistory = async (req, res) => {
  try {
    const {
      userId,
      leadId,
      status,
      direction,
      startDate,
      endDate,
      format = "csv",
    } = req.body;
    
    const currentUser = req.user;
    
    console.log("📥 exportCallHistory - User:", currentUser.id, "Role:", currentUser.role);
    
    // Build filter
    const filter = {};
    
    // RBAC - Convert string ID to ObjectId
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
      console.log("🔒 RBAC Filter Applied - userId:", filter.userId);
    } else if (userId) {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
      console.log("👤 Admin Filter - userId:", filter.userId);
    }
    
    if (leadId) filter.leadId = leadId;
    if (status) filter.callStatus = status;
    if (direction) filter.callDirection = direction;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    
    // Fetch all matching calls (limit to prevent memory issues)
    const calls = await CallLog.find(filter)
      .populate("leadId", "customerName contactName mobileNumber email organization")
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .limit(10000) // Safety limit
      .lean();
    
    if (calls.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No calls found for export",
      });
    }
    
    // Transform data for export
    const exportData = calls.map((call) => ({
      "Call ID": call._id,
      "Date": new Date(call.createdAt).toLocaleString(),
      "Agent": call.userId?.username || "N/A",
      "Agent Number": call.agentNumber,
      "Customer Name": call.leadId?.contactName || call.leadId?.customerName || "N/A",
      "Customer Number": call.destinationNumber,
      "Direction": call.callDirection,
      "Status": call.callStatus,
      "Duration (sec)": call.duration || 0,
      "Disposition": call.disposition || "N/A",
      "Recording": call.recordingUrl ? "Yes" : "No",
      "Remarks": call.remarks || "",
    }));
    
    if (format === "csv") {
      // Generate CSV
      const parser = new Parser();
      const csv = parser.parse(exportData);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=call-history-${Date.now()}.csv`
      );
      res.send(csv);
    } else {
      // Return JSON for client-side processing
      res.status(200).json({
        success: true,
        data: exportData,
        total: exportData.length,
      });
    }
  } catch (error) {
    console.error("Export call history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export call history",
      error: error.message,
    });
  }
};

/**
 * Get call statistics
 * GET /api/calls/stats
 */
exports.getCallStats = async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const currentUser = req.user;
    
    console.log("📊 getCallStats - User:", currentUser.id, "Role:", currentUser.role);
    
    // Build filter
    const filter = {};
    
    // RBAC - Convert string ID to ObjectId
    if (currentUser.role !== "Admin" && currentUser.role !== "Superadmin") {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(currentUser.id);
      console.log("🔒 RBAC Filter Applied - userId:", filter.userId);
    } else if (userId) {
      filter.userId = mongoose.Types.ObjectId.createFromHexString(userId);
      console.log("👤 Admin Filter - userId:", filter.userId);
    }
    
    // Date range
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    
    // Aggregate statistics
    const stats = await CallLog.aggregate([
      { $match: filter },
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
          callsWithRecording: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ["$recordingUrl", null] }, { $ne: ["$recordingUrl", ""] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    
    const result = stats[0] || {
      totalCalls: 0,
      completedCalls: 0,
      answeredCalls: 0,
      failedCalls: 0,
      noAnswerCalls: 0,
      totalDuration: 0,
      avgDuration: 0,
      callsWithRecording: 0,
    };
    
    // Calculate rates
    result.completionRate =
      result.totalCalls > 0
        ? ((result.completedCalls / result.totalCalls) * 100).toFixed(2)
        : 0;
    result.answerRate =
      result.totalCalls > 0
        ? ((result.answeredCalls / result.totalCalls) * 100).toFixed(2)
        : 0;
    
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get call stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch call statistics",
      error: error.message,
    });
  }
};

/**
 * Debug: Get calls with recordings (temporary endpoint)
 * GET /api/calls/debug/recordings
 */
exports.debugRecordings = async (req, res) => {
  try {
    const callsWithRecordings = await CallLog.find({
      recordingUrl: { $exists: true, $ne: null, $ne: "" }
    })
    .populate("leadId", "customerName contactName")
    .populate("userId", "username")
    .limit(10)
    .lean();
    
    console.log("📊 Found calls with recordings:", callsWithRecordings.length);
    
    const debugInfo = callsWithRecordings.map(call => ({
      id: call._id,
      customer: call.leadId?.customerName || call.leadId?.contactName,
      agent: call.userId?.username,
      recordingUrl: call.recordingUrl,
      status: call.callStatus,
      duration: call.duration,
      createdAt: call.createdAt
    }));
    
    res.status(200).json({
      success: true,
      data: debugInfo,
      total: callsWithRecordings.length
    });
  } catch (error) {
    console.error("Debug recordings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch debug recordings",
      error: error.message,
    });
  }
};

module.exports = exports;
