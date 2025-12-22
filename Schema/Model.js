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
  refreshToken:{
    type:String,
    default:null
  },
  tokenVersion:{
    type:Number,
    default:0
  }
});

const User = mongoose.model("User", userSchema);

module.exports = User;
