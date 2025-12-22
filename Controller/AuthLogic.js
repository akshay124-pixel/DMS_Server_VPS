const User = require("../Schema/Model");
const bcrypt = require("bcryptjs");
const { generateToken, generateRefreshToken, verifyRefreshToken } = require("../utils/config jwt");

// Signup Controller 
const Signup = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingEmailUser = await User.findOne({ email });
    if (existingEmailUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      role,
      tokenVersion: 0,
    });

    await newUser.save();

    // ✅ Dono tokens generate karo
    const accessToken = generateToken(newUser);
    const refreshToken = generateRefreshToken(newUser);
    
    // ✅ Refresh token DB me save karo
    newUser.refreshToken = refreshToken;
    await newUser.save();

    res.status(201).json({
      message: "Your account has been created successfully!",
      user: {
        id: newUser._id.toString(),
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Signup Error:", error);
    return res.status(500).json({
      message: "Something went wrong while creating your account. Please try again later.",
    });
  }
};

// Login Controller
const Login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // ✅ .lean() hataya - kyunki hume .save() karna hai
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // ✅ Dono tokens generate karo
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // ✅ Refresh token DB me save karo
    user.refreshToken = refreshToken;
    await user.save();

    console.log("✅ Login successful for:", email);

    return res.status(200).json({
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        isAdmin: user.role === "Admin",
        isSuperadmin: user.role === "Superadmin",
      },
    });
  } catch (error) {
    console.error("Login Error:", error.message);
    return res.status(500).json({
      message: "Oops! Something went wrong while logging you in. Please try again later.",
    });
  }
};
const getUserRole = async (req, res) => {
  try {
    console.log("getUserRole: userId:", req.user.id, "role:", req.user.role); // Debug log
    return res.status(200).json({
      id: req.user.id,
      role: req.user.role,
      isAdmin: req.user.role === "Admin",
      isSuperadmin: req.user.role === "Superadmin",
    });
  } catch (error) {
    console.error("getUserRole Error:", error.message);
    return res.status(500).json({
      message:
        "Sorry, we couldn’t fetch your user role right now. Please try again later.",
    });
  }
};

const ChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, email } = req.body;
    const userId = req.user.id; // From JWT middleware

    console.log("ChangePassword: Request received", { userId, email });

    if (!currentPassword || !newPassword || !email) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be at least 8 characters long and include uppercase, lowercase, number, and special character",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log("ChangePassword: User not found", { userId });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.email !== email) {
      console.log("ChangePassword: Email mismatch", {
        providedEmail: email,
        userEmail: user.email,
      });
      return res.status(403).json({
        success: false,
        message: "Email does not match authenticated user",
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      console.log("ChangePassword: Current password incorrect for user", {
        userId,
      });
      return res
        .status(401)
        .json({ success: false, message: "Current password is incorrect" });
    }
   //✅ Password update + Token version increment + Refresh token clear step-5
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    user.lastPasswordChange = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.refreshToken = null;
    await user.save();
    console.log("ChangePassword: Password changed successfully for user", {
      userId,
    });

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
      requireRelogin:true
    });
  } catch (error) {
    console.error("Change Password Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "An error occurred while changing password",
    });
  }
};

// ✅ Refresh Access Token Controller
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
        code: "NO_REFRESH_TOKEN",
      });
    }

    // ✅ Refresh token verify karo
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    // ✅ User find karo
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // ✅ Database me stored token match karna chahiye
    if (user.refreshToken !== refreshToken) {
      console.log("⚠️ Refresh token mismatch - possible token reuse attack");
      return res.status(401).json({
        success: false,
        message: "Refresh token has been revoked",
        code: "TOKEN_REVOKED",
      });
    }

    // ✅ Token version check (password change detection)
    // Note: null/undefined ko 0 treat karo for backward compatibility
    const userTokenVersion = user.tokenVersion || 0;
    const decodedTokenVersion = decoded.tokenVersion || 0;
    
    if (userTokenVersion !== decodedTokenVersion) {
      console.log("⚠️ Token version mismatch - password was changed");
      return res.status(401).json({
        success: false,
        message: "Token invalidated due to password change",
        code: "TOKEN_VERSION_MISMATCH",
      });
    }

    // ✅ Naye tokens generate karo
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // ✅ Naya refresh token save karo (token rotation)
    user.refreshToken = newRefreshToken;
    await user.save();

    console.log("✅ Tokens refreshed for user:", user.email);

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh Token Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to refresh token",
      code: "REFRESH_FAILED",
    });
  }
};

const logout = async(req,res)=>{
  try {
    const userId= req.user.id;
    await User.findByIdAndUpdate(userId,{refreshToken :null})
     console.log("✅ User logged out:", userId);
     return res.status(200).json({
      success:true,
      message: "Logged out successfully",
     })
  } catch (error) {
    console.error("Logout Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to logout",
    });
  }
}



module.exports = { Signup, Login, getUserRole,logout, ChangePassword,refreshAccessToken };
