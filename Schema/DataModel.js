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
    match: [/^\d{10}$/, "Mobile number must be exactly 10 digits"],
  },
  AlterNumber: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, "Mobile number must be exactly 10 digits"],
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
  
  // Smartflo Integration Fields
  smartfloLeadId: {
    type: String,
    trim: true,
    sparse: true,
  },
  
  lastCallDate: {
    type: Date,
  },
  
  lastCallStatus: {
    type: String,
    trim: true,
  },
  
  totalCallsMade: {
    type: Number,
    default: 0,
    min: 0,
  },
});

EntrySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const Entry = mongoose.model("Entry", EntrySchema);

module.exports = Entry;
