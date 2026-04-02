const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const kycOutletUpdate = asyncHandler(async (req, res) => {
  try {
    const outletApprovedId = req.user; // Set by protectRetailerRoute middleware

    // Find the outlet
    const outlet = await OutletApproved.findById(outletApprovedId);
    if (!outlet) {
      return res.status(404).json({
        error: true,
        message: "Outlet not found",
      });
    }

    // Extract fields from request body
    const { panImage, aadharImage, panNumber, aadharNumber, gstin, shipToPincode, shipToAddress, ownerName, outletName, mobile1, whatsappNumber, email,address1,pin,outletImage } = req.body;

    // Basic validation
    // Check if at least one KYC document is provided for update
    const hasKycUpdate = panImage || aadharImage || panNumber || aadharNumber;
    
    // GSTIN validation (15 character format: 2 chars + 10 chars alphanumeric + 1 char + 2 chars + 1 char checksum)
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(gstin)) {
      return res.status(400).json({
        error: true,
        message: "Invalid GSTIN format",
      });
    }

    // Email validation
    if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({
        error: true,
        message: "Invalid email format",
      });
    }

    // Mobile1 validation (10 digit Indian mobile number)
    if (mobile1 && !/^[6-9]\d{9}$/.test(mobile1)) {
      return res.status(400).json({
        error: true,
        message: "Invalid mobile number format",
      });
    }

    // WhatsApp number validation
    if (whatsappNumber && !/^[6-9]\d{9}$/.test(whatsappNumber)) {
      return res.status(400).json({
        error: true,
        message: "Invalid WhatsApp number format",
      });
    }

    // Pincode validation (6 digit Indian pincode)
    if (pin && !/^[1-9][0-9]{5}$/.test(pin)) {
      return res.status(400).json({
        error: true,
        message: "Invalid pincode format",
      });
    }

    // ShipTo Pincode validation
    if (shipToPincode && !/^[1-9][0-9]{5}$/.test(shipToPincode)) {
      return res.status(400).json({
        error: true,
        message: "Invalid ship-to pincode format",
      });
    }

    // PAN number validation
    if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber)) {
      return res.status(400).json({
        error: true,
        message: "Invalid PAN number format",
      });
    }

    // Aadhar number validation
    if (aadharNumber && !/^\d{12}$/.test(aadharNumber)) {
      return res.status(400).json({
        error: true,
        message: "Invalid Aadhaar number format",
      });
    }

    // Validate that PAN number and Aadhar number are not the same
    if (panNumber && aadharNumber && panNumber.toUpperCase() === aadharNumber.slice(-10).toUpperCase()) {
      return res.status(400).json({
        error: true,
        message: "PAN number cannot match Aadhaar number",
      });
    }

    // Check for duplicate mobile1
    if (mobile1 && mobile1 !== outlet.mobile1) {
      const existingOutlet = await OutletApproved.findOne({
        mobile1: mobile1,
        _id: { $ne: outletApprovedId },
        status: true,
      });
      if (existingOutlet) {
        return res.status(400).json({
          error: true,
          message: "Mobile number already exists for another outlet",
        });
      }
    }

    // Prepare update object
    const updateFields = {};

    if (panNumber !== undefined) {
      updateFields.panNumber = panNumber;
    }

    if (aadharNumber !== undefined) {
      updateFields.aadharNumber = aadharNumber;
    }

    if (panImage !== undefined) {
      updateFields.panImage = panImage;
    }

    if (aadharImage !== undefined) {
      updateFields.aadharImage = aadharImage;
    }

    if (gstin !== undefined) {
      updateFields.gstin = gstin;
    }

    if (shipToPincode !== undefined) {
      updateFields.shipToPincode = shipToPincode;
    }

    if (shipToAddress !== undefined) {
      updateFields.shipToAddress = shipToAddress;
    }

    if (ownerName !== undefined) {
      updateFields.ownerName = ownerName;
    }

    if (outletName !== undefined) {
      updateFields.outletName = outletName;
    }

    if (mobile1 !== undefined) {
      updateFields.mobile1 = mobile1;
    }

    if (whatsappNumber !== undefined) {
      updateFields.whatsappNumber = whatsappNumber;
    }

    if (email !== undefined) {
      updateFields.email = email;
    }

    if (address1 !== undefined) {
      updateFields.address1 = address1;
    }

    if (pin !== undefined) {
      updateFields.pin = pin;
    }

    if (outletImage !== undefined) {
      updateFields.outletImage = outletImage;
    }

    // Update the outlet
    const updatedOutlet = await OutletApproved.findByIdAndUpdate(
      outletApprovedId,
      updateFields,
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      error: false,
      message: "KYC details updated successfully",
      updatedOutlet,
    });
  } catch (error) {
    console.error("KYC Update Error:", error);
    res.status(500).json({
      error: true,
      message: "Internal server error",
      details: error.message,
    });
  }
});

module.exports = kycOutletUpdate;
