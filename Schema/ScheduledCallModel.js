const mongoose = require("mongoose");

/**
 * ScheduledCall Schema - Tracks scheduled future calls
 * Allows agents to plan and manage upcoming calls with leads
 */
const ScheduledCallSchema = new mongoose.Schema({
  // Lead reference
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Entry",
    required: true,
    index: true,
  },
  
  // Agent/User who scheduled the call
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  
  // Scheduled date and time
  scheduledTime: {
    type: Date,
    required: true,
    index: true,
  },
  
  // Priority level
  priority: {
    type: String,
    enum: ["low", "medium", "high", "urgent"],
    default: "medium",
    index: true,
  },
  
  // Call purpose/type
  purpose: {
    type: String,
    enum: [
      "follow_up",
      "demo",
      "negotiation",
      "closing",
      "support",
      "feedback",
      "renewal",
      "upsell",
      "other"
    ],
    required: true,
  },
  
  // Additional notes/agenda
  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ["pending", "completed", "cancelled", "missed"],
    default: "pending",
    index: true,
  },
  
  // Completion details
  completedAt: {
    type: Date,
  },
  
  completionNotes: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  
  // Call outcome (if completed)
  outcome: {
    type: String,
    enum: ["successful", "no_answer", "busy", "voicemail", "callback_requested", "not_interested"],
  },
  
  // Link to actual call log (if call was made)
  callLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CallLog",
  },
  
  // Reminder sent flag
  reminderSent: {
    type: Boolean,
    default: false,
  },
  
  // Timestamps
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
ScheduledCallSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
ScheduledCallSchema.index({ userId: 1, scheduledTime: 1 });
ScheduledCallSchema.index({ leadId: 1, status: 1 });
ScheduledCallSchema.index({ status: 1, scheduledTime: 1 });
ScheduledCallSchema.index({ priority: 1, scheduledTime: 1 });

// Virtual for checking if call is overdue
ScheduledCallSchema.virtual("isOverdue").get(function () {
  return this.status === "pending" && this.scheduledTime < new Date();
});

// Method to mark as completed
ScheduledCallSchema.methods.markCompleted = function (notes, outcome) {
  this.status = "completed";
  this.completedAt = new Date();
  this.completionNotes = notes || "";
  this.outcome = outcome || "successful";
  return this.save();
};

// Method to mark as missed
ScheduledCallSchema.methods.markMissed = function () {
  this.status = "missed";
  return this.save();
};

// Static method to find overdue calls
ScheduledCallSchema.statics.findOverdue = function () {
  return this.find({
    status: "pending",
    scheduledTime: { $lt: new Date() },
  });
};

// Static method to find upcoming calls for a user
ScheduledCallSchema.statics.findUpcoming = function (userId, hours = 24) {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
  
  return this.find({
    userId,
    status: "pending",
    scheduledTime: { $gte: now, $lte: future },
  }).sort({ scheduledTime: 1 });
};

const ScheduledCall = mongoose.model("ScheduledCall", ScheduledCallSchema);

module.exports = ScheduledCall;
