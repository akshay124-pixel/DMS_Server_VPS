const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["Superadmin", "Admin", "Others"],
    default: "Others",
    required: true,
  },
  lastPasswordChange: {
    type: Date,
    default: Date.now,
  },
  
  // Refresh Token System Fields
  refreshToken: {
    type: String,
    default: null,
  },
  tokenVersion: {
    type: Number,
    default: 0,
  },
  
  // Smartflo Integration Fields
  smartfloUserId: {
    type: String,
    trim: true,
    sparse: true,
  },
  
  smartfloAgentNumber: {
    type: String,
    trim: true,
    sparse: true,
  },
  
  smartfloExtension: {
    type: String,
    trim: true,
  },
  
  smartfloEnabled: {
    type: Boolean,
    default: false,
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;
