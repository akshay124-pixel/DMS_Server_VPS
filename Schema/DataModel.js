const mongoose = require("mongoose");

const EntrySchema = new mongoose.Schema({
  customerName: {
    type: String,
    trim: true,
  },
  contactName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  mobileNumber: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^\d{10}$/.test(v); // Allow empty or exactly 10 digits
      },
      message: "Mobile number must be exactly 10 digits"
    },
  },
  AlterNumber: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^\d{10}$/.test(v); // Allow empty or exactly 10 digits
      },
      message: "Alternate number must be exactly 10 digits"
    },
  },
  product: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
    maxlength: [200, "Address cannot exceed 200 characters"],
  },
  organization: {
    type: String,
    trim: true,
    maxlength: [100, "Organization cannot exceed 100 characters"],
  },
  category: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    trim: true,
  },
  state: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    default: "Not Found",
  },
  closetype: {
    type: String,
    enum: ["Closed Won", "Closed Lost", ""],
    default: "",
  },
  closeamount: { type: Number, min: 0 },
  remarks: {
    type: String,
    trim: true,
    maxlength: [500, "Remarks cannot exceed 500 characters"],
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "Created by user is required"],
  },
  history: [
    {
      status: {
        type: String,
        enum: [
          "Interested",
          "Not Interested",
          "Maybe",
          "Closed",
          "Not",
          "Service",
          "Not Found",
        ],
      },
      remarks: {
        type: String,
        trim: true,
        maxlength: [500, "Remarks cannot exceed 500 characters"],
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
});

// 🔥 -------------------------------------------------------
// 🔥 INDEXES FOR MASSIVE PERFORMANCE BOOST — DO NOT REMOVE
// 🔥 -------------------------------------------------------

// Most used query → get entries by user + latest first
EntrySchema.index({ createdBy: 1, createdAt: -1 });

// Status filtering
EntrySchema.index({ status: 1 });

// Organization filtering
EntrySchema.index({ organization: 1 });

// State + City (regional filtering)
EntrySchema.index({ state: 1, city: 1 });

// Date sorting optimization
EntrySchema.index({ createdAt: -1 });
EntrySchema.index({ updatedAt: -1 });

// Text search index (for searching name + address)
EntrySchema.index({ customerName: "text", address: "text" });

// Mobile number fast search
EntrySchema.index({ mobileNumber: 1 });

// Alternate number search
EntrySchema.index({ AlterNumber: 1 });

// Category filter optimization
EntrySchema.index({ category: 1 });

// City filter optimization
EntrySchema.index({ city: 1 });

// State filter optimization
EntrySchema.index({ state: 1 });

// -------------------------------------------------------

EntrySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const Entry = mongoose.model("Entry", EntrySchema);

module.exports = Entry;
