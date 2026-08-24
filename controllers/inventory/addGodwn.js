const asyncHandler = require("express-async-handler");
const Godown = require("../../models//godown.model");
const Distributor = require("../../models/distributor.model");

const addGodown = asyncHandler(async (req, res) => {
  try {
    const {
      distributorId,
      godownCode,
      godownName,
      godownType,
      location,
      contactPerson,
      isActive,
      remarks,
    } = req.body;

    // Required fields
    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    if (!godownCode) {
      return res.status(400).json({
        success: false,
        message: "Godown code is required",
      });
    }

    if (!godownName) {
      return res.status(400).json({
        success: false,
        message: "Godown name is required",
      });
    }

    // Check distributor exists
    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      return res.status(404).json({
        success: false,
        message: "Distributor not found",
      });
    }

    // Check duplicate godown code for same distributor
    const existingGodown = await Godown.findOne({
      distributorId,
      godownCode: godownCode.trim(),
    });

    if (existingGodown) {
      return res.status(400).json({
        success: false,
        message: "Godown code already exists for this distributor",
      });
    }

    // Create godown
    const godown = await Godown.create({
      distributorId,
      godownCode: godownCode.trim(),
      godownName: godownName.trim(),
      godownType: godownType || "MAIN",
      location: location || "",
      contactPerson: contactPerson || "",
      isActive:
        typeof isActive === "boolean"
          ? isActive
          : true,
      remarks: remarks || "",
    });

    // Populate distributor details
    const createdGodown = await Godown.findById(godown._id).populate(
      "distributorId",
      "name dbCode email phone"
    );

    return res.status(201).json({
      success: true,
      message: "Godown added successfully",
      data: createdGodown,
    });
  } catch (error) {
    console.error("Add Godown Error:", error);

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Godown code already exists for this distributor",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to add godown",
      error: error.message,
    });
  }
});

module.exports = {
  addGodown,
};