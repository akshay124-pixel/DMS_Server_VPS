const mongoose = require("mongoose");

/**
 * SmartfloConfig Schema - Stores Smartflo campaign and lead list configurations
 * Used for managing dialer campaigns and lead synchronization
 */
const SmartfloConfigSchema = new mongoose.Schema({
  // Smartflo Lead List details
  leadListId: {
    type: String,
    trim: true,
    index: true,
  },
  
  leadListName: {
    type: String,
    required: true,
    trim: true,
  },
  
  // Smartflo Campaign details
  campaignId: {
    type: String,
    trim: true,
    index: true,
  },
  
  campaignName: {
    type: String,
    trim: true,
  },
  
  campaignType: {
    type: String,
    enum: ["progressive", "predictive", "preview", "manual"],
    default: "progressive",
  },
  
  // Segment criteria for filtering leads from CRM
  segmentCriteria: {
    status: [String],
    category: [String],
    state: [String],
    city: [String],
    dateRange: {
      from: Date,
      to: Date,
    },
  },
  
  // Configuration status
  isActive: {
    type: Boolean,
    default: true,
  },
  
  // Sync statistics
  totalLeadsSynced: {
    type: Number,
    default: 0,
  },
  
  lastSyncDate: {
    type: Date,
  },
  
  // Creator reference
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
SmartfloConfigSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const SmartfloConfig = mongoose.model("SmartfloConfig", SmartfloConfigSchema);

module.exports = SmartfloConfig;
