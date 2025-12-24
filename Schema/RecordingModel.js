const mongoose = require("mongoose");

/**
 * Recording Schema - Tracks call recordings separately for better management
 * Stores recording metadata, access URLs, and download status
 */
const RecordingSchema = new mongoose.Schema({
  // Reference to call log
  callLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CallLog",
    required: true,
    index: true,
  },
  
  // Smartflo recording identifier
  recordingId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },
  
  // Recording URL from Smartflo (may be temporary/signed)
  recordingUrl: {
    type: String,
    trim: true,
  },
  
  // Recording status
  status: {
    type: String,
    enum: ["pending", "available", "downloaded", "failed", "expired"],
    default: "pending",
    index: true,
  },
  
  // Recording duration in seconds
  duration: {
    type: Number,
    default: 0,
    min: 0,
  },
  
  // File size in bytes
  fileSize: {
    type: Number,
    default: 0,
  },
  
  // File format (mp3, wav, etc.)
  format: {
    type: String,
    default: "mp3",
  },
  
  // Local storage path (if downloaded)
  localPath: {
    type: String,
    trim: true,
  },
  
  // URL expiry time (for signed URLs)
  urlExpiresAt: {
    type: Date,
  },
  
  // Last accessed timestamp
  lastAccessedAt: {
    type: Date,
  },
  
  // Access count
  accessCount: {
    type: Number,
    default: 0,
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
RecordingSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for performance
RecordingSchema.index({ callLogId: 1, status: 1 });
RecordingSchema.index({ status: 1, createdAt: -1 });

// Method to check if URL is expired
RecordingSchema.methods.isUrlExpired = function () {
  if (!this.urlExpiresAt) return false;
  return Date.now() >= this.urlExpiresAt.getTime();
};

// Method to increment access count
RecordingSchema.methods.recordAccess = async function () {
  this.accessCount += 1;
  this.lastAccessedAt = new Date();
  await this.save();
};

const Recording = mongoose.model("Recording", RecordingSchema);

module.exports = Recording;
