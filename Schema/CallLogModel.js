const mongoose = require("mongoose");

/**
 * CallLog Schema - Tracks all telephony interactions via Smartflo
 * Stores call details, status, recordings, and links to leads/users
 */
const CallLogSchema = new mongoose.Schema({
  // Lead/Contact reference
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Entry",
    required: true,
    index: true,
  },
  
  // Agent/User who made/received the call
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  
  // Smartflo call details
  agentNumber: {
    type: String,
    required: true,
    trim: true,
  },
  
  destinationNumber: {
    type: String,
    required: true,
    trim: true,
  },
  
  callerId: {
    type: String,
    trim: true,
  },
  
  // Smartflo's unique call identifier
  providerCallId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },
  
  // Custom identifier for tracking
  customIdentifier: {
    type: String,
    trim: true,
  },
  
  // Call status tracking
  callStatus: {
    type: String,
    enum: [
      "initiated",
      "ringing",
      "answered",
      "completed",
      "failed",
      "no_answer",
      "busy",
      "cancelled",
    ],
    default: "initiated",
    index: true,
  },
  
  // Call direction
  callDirection: {
    type: String,
    enum: ["outbound", "inbound"],
    default: "outbound",
    required: true,
    index: true, // Add index for filtering
  },
  
  // Virtual number used (CRITICAL for incoming calls)
  virtualNumber: {
    type: String,
    trim: true,
    index: true, // Index for virtual number analytics
  },
  
  // Queue information for inbound calls
  queueId: {
    type: String,
    trim: true,
  },
  
  queueWaitTime: {
    type: Number,
    default: 0,
    min: 0,
  },
  
  // Agent assignment for inbound calls
  assignedAt: {
    type: Date,
  },
  
  // Call routing information
  routingReason: {
    type: String,
    enum: ["direct", "queue", "transfer", "callback", "ivr", "outbound"],
    default: "direct",
  },
  
  // Timing information
  startTime: {
    type: Date,
    default: Date.now,
  },
  
  endTime: {
    type: Date,
  },
  
  // Duration in seconds
  duration: {
    type: Number,
    default: 0,
    min: 0,
  },
  
  // Recording URL from Smartflo
  recordingUrl: {
    type: String,
    trim: true,
  },
  
  // Call disposition/outcome
  disposition: {
    type: String,
    trim: true,
  },
  
  // Agent remarks/notes
  remarks: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  
  // Call source tracking
  source: {
    type: String,
    enum: ["SMARTFLO", "MANUAL", "WEBHOOK"],
    default: "SMARTFLO",
    required: true,
  },
  
  // Call transfer tracking
  transferData: {
    transferredFrom: String,
    transferredTo: String,
    transferReason: String,
    transferTime: Date,
    transferType: {
      type: String,
      enum: ["blind", "attended", "warm"],
    },
  },
  
  // IVR interaction data
  ivrData: {
    menuSelections: [String],
    dtmfInputs: [String],
    ivrDuration: Number,
  },
  
  // Webhook event data (for debugging)
  webhookData: {
    type: mongoose.Schema.Types.Mixed,
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
CallLogSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
CallLogSchema.index({ leadId: 1, createdAt: -1 });
CallLogSchema.index({ userId: 1, createdAt: -1 });
CallLogSchema.index({ callStatus: 1, createdAt: -1 });
CallLogSchema.index({ callDirection: 1, createdAt: -1 }); // For direction filtering
CallLogSchema.index({ virtualNumber: 1, createdAt: -1 }); // For virtual number analytics
CallLogSchema.index({ providerCallId: 1 }); // For webhook updates (unique)

const CallLog = mongoose.model("CallLog", CallLogSchema);

module.exports = CallLog;
