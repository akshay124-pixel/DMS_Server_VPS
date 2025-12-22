const User = require("../Schema/Model");
const Entry = require("../Schema/DataModel");
const SmartfloConfig = require("../Schema/SmartfloConfigModel");
const smartfloClient = require("../services/smartfloClient");

/**
 * Smartflo Admin Controller
 * Handles user mapping, lead sync, campaign management, and admin operations
 */

/**
 * Get all users with Smartflo mapping status
 * GET /api/smartflo/users
 */
exports.getAllUsersWithMapping = async (req, res) => {
  try {
    const users = await User.find({}, {
      password: 0,
      lastPasswordChange: 0,
    }).sort({ username: 1 });

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

/**
 * Map user to Smartflo agent
 * PUT /api/smartflo/users/:userId/map
 */
exports.mapUserToSmartflo = async (req, res) => {
  try {
    const { userId } = req.params;
    const { smartfloUserId, smartfloAgentNumber, smartfloExtension, smartfloEnabled } = req.body;

    // Validate admin role
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update Smartflo mapping
    user.smartfloUserId = smartfloUserId || user.smartfloUserId;
    user.smartfloAgentNumber = smartfloAgentNumber || user.smartfloAgentNumber;
    user.smartfloExtension = smartfloExtension || user.smartfloExtension;
    user.smartfloEnabled = smartfloEnabled !== undefined ? smartfloEnabled : user.smartfloEnabled;

    await user.save();

    res.status(200).json({
      success: true,
      message: "User mapped to Smartflo successfully",
      data: {
        userId: user._id,
        username: user.username,
        smartfloAgentNumber: user.smartfloAgentNumber,
        smartfloEnabled: user.smartfloEnabled,
      },
    });
  } catch (error) {
    console.error("Map user error:", error);
    res.status(500).json({
      message: "Failed to map user",
      error: error.message,
    });
  }
};

/**
 * Sync leads to Smartflo lead list
 * POST /api/smartflo/lead-sync
 */
exports.syncLeadsToSmartflo = async (req, res) => {
  try {
    const { leadListName, segmentCriteria } = req.body;
    const userId = req.user.id;

    // Validate admin role
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    // Build filter based on segment criteria
    const filter = {};
    if (segmentCriteria) {
      if (segmentCriteria.status && segmentCriteria.status.length > 0) {
        filter.status = { $in: segmentCriteria.status };
      }
      if (segmentCriteria.category && segmentCriteria.category.length > 0) {
        filter.category = { $in: segmentCriteria.category };
      }
      if (segmentCriteria.state && segmentCriteria.state.length > 0) {
        filter.state = { $in: segmentCriteria.state };
      }
      if (segmentCriteria.city && segmentCriteria.city.length > 0) {
        filter.city = { $in: segmentCriteria.city };
      }
      if (segmentCriteria.dateRange) {
        filter.createdAt = {};
        if (segmentCriteria.dateRange.from) {
          filter.createdAt.$gte = new Date(segmentCriteria.dateRange.from);
        }
        if (segmentCriteria.dateRange.to) {
          filter.createdAt.$lte = new Date(segmentCriteria.dateRange.to);
        }
      }
    }

    // Fetch leads matching criteria
    const leads = await Entry.find(filter).select(
      "customerName contactName mobileNumber email organization"
    );

    if (leads.length === 0) {
      return res.status(400).json({ message: "No leads found matching criteria" });
    }

    // Create lead list in Smartflo
    const leadListResponse = await smartfloClient.createLeadList(
      leadListName || `CRM_Sync_${Date.now()}`,
      `Synced from CRM on ${new Date().toISOString()}`
    );

    const leadListId = leadListResponse.id || leadListResponse.lead_list_id;

    // Add leads to Smartflo lead list
    let successCount = 0;
    let failCount = 0;

    for (const lead of leads) {
      try {
        await smartfloClient.addLeadToList(leadListId, {
          firstName: lead.contactName || lead.customerName,
          phoneNumber: lead.mobileNumber,
          email: lead.email,
          company: lead.organization,
        });

        // Update lead with Smartflo ID
        lead.smartfloLeadId = leadListId;
        await lead.save();

        successCount++;
      } catch (error) {
        console.error(`Failed to add lead ${lead._id}:`, error.message);
        failCount++;
      }
    }

    // Save configuration
    const config = new SmartfloConfig({
      leadListId,
      leadListName: leadListName || `CRM_Sync_${Date.now()}`,
      segmentCriteria,
      totalLeadsSynced: successCount,
      lastSyncDate: new Date(),
      createdBy: userId,
    });

    await config.save();

    res.status(200).json({
      success: true,
      message: "Leads synced to Smartflo successfully",
      data: {
        leadListId,
        totalLeads: leads.length,
        successCount,
        failCount,
        configId: config._id,
      },
    });
  } catch (error) {
    console.error("Lead sync error:", error);
    res.status(500).json({
      message: "Failed to sync leads",
      error: error.message,
    });
  }
};

/**
 * Create dialer campaign
 * POST /api/smartflo/campaign/create
 */
exports.createCampaign = async (req, res) => {
  try {
    const {
      campaignName,
      leadListId,
      campaignType,
      agentNumbers,
      callerId,
      startTime,
      endTime,
    } = req.body;
    const userId = req.user.id;

    // Validate admin role
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    // Validate required fields
    if (!campaignName || !leadListId) {
      return res.status(400).json({ message: "Campaign name and lead list ID are required" });
    }

    // Create campaign in Smartflo
    const campaignResponse = await smartfloClient.createCampaign({
      name: campaignName,
      leadListId,
      campaignType: campaignType || "progressive",
      agentNumbers: agentNumbers || [],
      callerId: callerId || process.env.SMARTFLO_DEFAULT_CALLER_ID,
      startTime,
      endTime,
    });

    const campaignId = campaignResponse.id || campaignResponse.campaign_id;

    // Update config with campaign details
    const config = await SmartfloConfig.findOne({ leadListId });
    if (config) {
      config.campaignId = campaignId;
      config.campaignName = campaignName;
      config.campaignType = campaignType || "progressive";
      await config.save();
    }

    res.status(200).json({
      success: true,
      message: "Campaign created successfully",
      data: {
        campaignId,
        campaignName,
        leadListId,
      },
    });
  } catch (error) {
    console.error("Create campaign error:", error);
    res.status(500).json({
      message: "Failed to create campaign",
      error: error.message,
    });
  }
};

/**
 * Get all campaigns
 * GET /api/smartflo/campaigns
 */
exports.getCampaigns = async (req, res) => {
  try {
    const configs = await SmartfloConfig.find({ campaignId: { $exists: true, $ne: null } })
      .populate("createdBy", "username email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: configs,
    });
  } catch (error) {
    console.error("Get campaigns error:", error);
    res.status(500).json({
      message: "Failed to fetch campaigns",
      error: error.message,
    });
  }
};

/**
 * Get Smartflo dispositions
 * GET /api/smartflo/dispositions
 */
exports.getDispositions = async (req, res) => {
  try {
    const dispositions = await smartfloClient.getDispositions();

    res.status(200).json({
      success: true,
      data: dispositions,
    });
  } catch (error) {
    console.error("Get dispositions error:", error);
    res.status(500).json({
      message: "Failed to fetch dispositions",
      error: error.message,
    });
  }
};

/**
 * Test Smartflo connection
 * POST /api/smartflo/test-connection
 */
exports.testConnection = async (req, res) => {
  try {
    // Validate admin role
    if (req.user.role !== "Superadmin" && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    const result = await smartfloClient.testConnection();

    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    res.status(500).json({
      success: false,
      message: "Connection test failed",
      error: error.message,
    });
  }
};
