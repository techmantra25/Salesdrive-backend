const asyncHandler = require("express-async-handler");
const User = require("../models/user.model.js");
const generateToken = require("../utils/generateToken.js");
const sendEmail = require("../utils/sendEmail.js");
const { CLIENT_URL } = require("../config/server.config.js");
const crypto = require("crypto");

const getMe = asyncHandler(async (req, res) => {
  try {
    res.status(200).json({
      status: 200,
      data: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        avatar: req.user.avatar,
        role: req.user.role,
        status: req.user.status,
      },
    });
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

const loginUser = asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      const token = generateToken(user._id);

      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      res.cookie("token", token, {
        httpOnly: true,
        secure:  "true",
        sameSite: "none",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        priority: "high",
      });

      return res.status(200).json({
        status: 200,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          status: user.status,
        },
      });
    } else {
      res.status(401);
      throw new Error("Invalid email or password");
    }
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

const logoutUser = asyncHandler(async (req, res) => {
  try {
    res.cookie("token", "", {
      httpOnly: true,
      secure:  "true",
      sameSite: "none",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });

    return res.status(200).json({
      status: 200,
      message: "Logged out successfully",
    });
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Something went wrong");
  }
});

const updateUserProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.body._id).select("-password");

    if (user) {
      user.name = req?.body?.name || user?.name;
      user.email = req?.body?.email || user?.email;
      if (req?.body?.password) {
        user.password = req?.body?.password;
      }
      user.avatar = req?.body?.avatar || user?.avatar;
      user.role = req?.body?.role || user?.role;
      user.status = req?.body?.status || user?.status;

      let newUpdatedUser = await user.save();

      const token = generateToken(req.body._id);

      let resultUser = {
        ...newUpdatedUser._doc,
        token,
      };
      delete resultUser.password;

      res.status(200).json({
        status: 200,
        data: resultUser,
      });
    } else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(404);
    throw new Error("User not found");
  }
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    const resetToken = user.createResetToken();
    user.save();

    const resetUrl = `${CLIENT_URL}/reset-password/${resetToken}`;

    const htmlMessage = `<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
        <tr>
            <td style="text-align: center; padding: 10px 0;">
                <h1 style="color: #333333;">RUPA DMS</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px;">
                <h2 style="color: #333333;">Reset Your Password</h2>
                <p style="color: #555555; line-height: 1.5;">
                    Hello,
                </p>
                <p style="color: #555555; line-height: 1.5;">
                    We received a request to reset your password for your RUPA DMS account. Click the button below to reset your password.
                </p>
                <p style="text-align: center; padding: 20px 0;">
                    <a href=${resetUrl} style="background-color: #28a745; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 5px;">Reset Password</a>
                </p>
                <p style="color: #555555; line-height: 1.5;">
                    If the button above does not work, copy and paste the following link into your browser:
                </p>
                <p style="color: #555555; line-height: 1.5;">
                    <a href=${resetUrl} style="color: #28a745;">${resetUrl}</a>
                </p>
                <p style="color: #555555; line-height: 1.5;">
                    If you did not request a password reset, please ignore this email or contact support if you have questions.
                </p>
                <p style="color: #555555; line-height: 1.5;">
                    Thanks,<br>
                    The RUPA DMS Team
                </p>
            </td>
        </tr>
        <tr>
            <td style="text-align: center; padding: 20px 0; color: #999999; font-size: 12px;">
                &copy;
    2024 RUPA DMS.All rights reserved.</ td></ tr></ table></ body>`;

    try {
      await sendEmail({
        email: user.email,
        subject: "RUPA DMS: Reset Your Password (valid for 10 minutes)",
        htmlMessage,
      });

      res.status(200).json({
        status: 200,
        message: "Token sent to email!",
      });
    } catch (error) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.save();
      res.status(500).json({
        status: 500,
        message: "There was an error sending the email. Try again later!",
      });
    }
  } catch (error) {
    res.status(404);
    throw new Error("User not found");
  }
});

const resetPassword = asyncHandler(async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.resetToken)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("-password");

    if (!user) {
      return res.status(400).json({
        status: 400,
        message: "Token is invalid or has expired",
      });
    }

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({
      status: 200,
      message: "Password reset successful",
      data: user,
    });
  } catch (error) {
    res.status(400);
    throw new Error("Invalid token");
  }
});

const userRegister = asyncHandler(async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const userExist = await User.findOne({ email });
    if (userExist) {
      return res.status(400).json({
        status: 400,
        message: "User already exists",
      });
    }

    const avatar = `https://img.icons8.com/officel/80/user.png`;

    const user = await User.create({
      name,
      email,
      avatar,
      password,
      role,
    });

    res.status(201).json({
      status: 201,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getMe,
  loginUser,
  logoutUser,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  userRegister,
};
