const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const RetailerLogin = require("../../models/retailerLogin.model");
const OutletApproved = require("../../models/outletApproved.model");
const serverConfig = require("../../config/server.config");

const verifyOtp = asyncHandler(async (req, res) => {
  try {
    const { contact, otp } = req.body;

    if (!contact || !otp) {
      return res.status(400).json({
        error: true,
        message: "Contact and OTP are required",
      });
    }

    // Find approved outlet
    const outletApproved = await OutletApproved.findOne({
      mobile1: contact,
      status: true,
    });

    if (!outletApproved) {
      return res.status(400).json({
        error: true,
        message: "Outlet not found",
      });
    }

    // Find login record
    const loginRecord = await RetailerLogin.findOne({
      outletApprovedId: outletApproved._id,
      otp: otp,          // FIXED: String match
      status: true,
    }).sort({ createdAt: -1 });

    if (!loginRecord) {
      return res.status(400).json({
        error: true,
        message: "Invalid or expired OTP",
      });
    }

    // Generate token
    const token = jwt.sign(
      {
        retailerLoginId: loginRecord._id,
        outletApprovedId: outletApproved._id,
        contact: contact,
      },
      serverConfig.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Update record
    loginRecord.token = token;
    loginRecord.otp = undefined;   // ✅ VALID
    await loginRecord.save();

    res.status(200).json({
      error: false,
      message: "OTP verified successfully",
      data: {
        token,
        outletApprovedId: outletApproved._id,
      },
    });

  } catch (error) {
    console.error("Verify OTP Error:", error);

    res.status(500).json({
      error: true,
      message: "Internal server error",
      details: error.message,
    });
  }
});

module.exports = verifyOtp;
