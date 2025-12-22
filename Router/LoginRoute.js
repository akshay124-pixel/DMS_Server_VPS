const { Login, ChangePassword ,logout,refreshAccessToken } = require("../Controller/AuthLogic");
const { verifyToken } = require("../utils/config jwt");
const express = require("express");
const router = express.Router();

router.route("/login").post(Login);
router.route("/change-password").post(verifyToken, ChangePassword);
router.post("/logout", verifyToken, logout);
router.post("/refresh-token", refreshAccessToken);
router.get("/verify-token", verifyToken, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Token is valid",
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});
module.exports = router;
