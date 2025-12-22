const nodemailer = require("nodemailer");
const path = require("path");
require('dotenv').config();

// Create a transporter for sending emails
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Async function to send email with attachment
async function sendMail(to, subject, text, html) {
  try {
    // Define the image path on the server
    const imagePath = path.join("/www/wwwroot/DMS_Server/Images", "Promark Techsolutions Pvt Ltd.jpg");

    // Send email with attachment
    await transporter.sendMail({
      from: '"Promark Tech Solutions" <salesorderweb@gmail.com>',
      to,
      subject,
      text,
      html,
      attachments: [
        {
          filename: "Promark Techsolutions Pvt Ltd.jpg",
          path: imagePath,
          cid: "middle-image",
        },
      ],
    });
    console.log(`Email sent successfully to ${to}`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error
  }
}

module.exports = { sendMail };