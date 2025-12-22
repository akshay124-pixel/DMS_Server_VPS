const mongoose = require("mongoose");
URI = process.env.DB_URL;

const dbconnect = async () => {
  try {
    await mongoose.connect(URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.log("Error connecting to MongoDB");
  }
};
module.exports = dbconnect;
