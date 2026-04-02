const asyncHandler = require("express-async-handler");
const axios = require("axios");
const RetailerLogin = require("../../models/retailerLogin.model");
const OutletApproved = require("../../models/outletApproved.model");

// Utility: Generate 4-digit OTP
const generateOTP = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

const resendOtp = asyncHandler(async (req, res) => {
  const { contact } = req.body;

  if (!contact) {
    return res.status(400).json({
      error: true,
      message: "Contact number is required",
    });
  }

  // Check approved outlet
  const outletApproved = await OutletApproved.findOne({
    mobile1: contact,
    status: true,
  });

  if (!outletApproved) {
    return res.status(400).json({
      error: true,
      message: "Outlet not found or not approved",
    });
  }

  // Generate new OTP
  const newOtp = generateOTP();

  // Save new OTP record
  await RetailerLogin.create({
    outletApprovedId: outletApproved._id,
    otp: newOtp,
    status: true,
  });

  // SMS config from ENV
  const url = process.env.SMS_URL;
  const params = {
    UserId: process.env.SMS_USER_ID,
    pwd: process.env.SMS_PASSWORD,
    Message: `Your PASSCODE for logging into the Rupa Pragati Application is ${newOtp}`,
    Contacts: contact,
    SenderId: process.env.SMS_SENDER_ID,
    ServiceName: process.env.SMS_SERVICE_NAME,
    MessageType: 1,
    DLTTemplateId: process.env.SMS_DLT_TEMPLATE_ID,
  };

  // Send SMS
  try {
    await axios.get(url, { params });
  } catch (smsError) {
    return res.status(500).json({
      error: true,
      message: "SMS sending failed",
      details: smsError.message,
    });
  }

  res.status(200).json({
    error: false,
    message: "OTP resent successfully",
  });
});

module.exports = resendOtp;
