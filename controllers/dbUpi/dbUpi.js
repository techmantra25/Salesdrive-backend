const asyncHandler = require("express-async-handler");
const DBUpi = require("../../models/dbUpi.model");
const Distributor = require("../../models/distributor.model");

// Create and Save a new DBUpi
const createDbUpi = asyncHandler(async (req, res) => {
  try {
    const { distributorId, upiId } = req.body;

    if (!distributorId || !upiId) {
      res.status(400);
      throw new Error("distributorId and upiId are required");
    }

    // Validate UPI ID format
    const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;
    if (!upiRegex.test(upiId)) {
      res.status(400);
      throw new Error("Invalid UPI ID format");
    }

    // Check if UPI already exists for this distributor
    const upiExists = await DBUpi.findOne({ distributorId });

    if (upiExists) {
      res.status(400);
      throw new Error("UPI ID already exists for this distributor");
    }

    // Get distributor details
    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    // Create new UPI entry
    const dbUpi = await DBUpi.create({
      distributorId,
      dbCode: distributor.dbCode,
      dbName: distributor.name,
      mobileNo: distributor.phone || "",
      upiId: upiId.trim(),
      isActive: true,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      status: 201,
      message: "UPI ID created successfully",
      data: dbUpi,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

// Update DBUpi
const updateDbUpi = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.params;
    const { upiId } = req.body;

    if (!distributorId || !upiId) {
      res.status(400);
      throw new Error("distributorId and upiId are required");
    }

    // Validate UPI ID format
    const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;
    if (!upiRegex.test(upiId)) {
      res.status(400);
      throw new Error("Invalid UPI ID format");
    }

    // Find the UPI entry
    const dbUpi = await DBUpi.findOne({ distributorId });

    if (!dbUpi) {
      res.status(404);
      throw new Error("UPI ID not found");
    }

    // Update the UPI ID
    dbUpi.upiId = upiId.trim();
    dbUpi.updatedBy = req.user?._id || null;
    await dbUpi.save();

    return res.status(200).json({
      status: 200,
      message: "UPI ID updated successfully",
      data: dbUpi,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

// Get DBUpi by distributorId
const getDbUpi = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.params;

    if (!distributorId) {
      res.status(400);
      throw new Error("distributorId is required");
    }

    // Find the UPI entry
    const dbUpi = await DBUpi.findOne({ distributorId, isActive: true });

    if (!dbUpi) {
      return res.status(200).json({
        status: 200,
        message: "No UPI ID found for this distributor",
        data: null,
      });
    }

    return res.status(200).json({
      status: 200,
      message: "UPI ID fetched successfully",
      data: dbUpi,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

// Delete/Deactivate DBUpi
const deleteDbUpi = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.params;

    if (!distributorId) {
      res.status(400);
      throw new Error("distributorId is required");
    }

    // Find and deactivate the UPI entry
    const dbUpi = await DBUpi.findOne({ distributorId });

    if (!dbUpi) {
      res.status(404);
      throw new Error("UPI ID not found");
    }

    dbUpi.isActive = false;
    dbUpi.updatedBy = req.user?._id || null;
    await dbUpi.save();

    return res.status(200).json({
      status: 200,
      message: "UPI ID deleted successfully",
      data: dbUpi,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createDbUpi, updateDbUpi, getDbUpi, deleteDbUpi };
