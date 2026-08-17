const asyncHandler = require("express-async-handler");
const Godown = require("../../models/godown.model");

const editGodown = asyncHandler(async (req, res) => {
  try {
    const { godownId } = req.params;

    const {
      godownCode,
      godownName,
      godownType,
      location,
      contactPerson,
      isActive,
      remarks,
    } = req.body;

    // Find godown
    const godown = await Godown.findById(godownId);

    if (!godown) {
      return res.status(404).json({
        success: false,
        message: "Godown not found",
      });
    }

    // ==========================================
    // ADMIN
    // ==========================================
    if (req.userType === "user" && req.user.role === "admin") {
      // Admin can edit any godown
    }

    // ==========================================
    // DISTRIBUTOR
    // ==========================================
    else if (req.userType === "distributor") {
      // Distributor can edit only their own godown
      if (
        godown.distributorId.toString() !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to edit this godown",
        });
      }
    }

    // ==========================================
    // OTHER USERS
    // ==========================================
    else {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to edit godown",
      });
    }

    // ==========================================
    // VALIDATION
    // ==========================================

    if (!godownCode || !godownCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "Godown code is required",
      });
    }

    if (!godownName || !godownName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Godown name is required",
      });
    }

    // ==========================================
    // CHECK DUPLICATE GODOWN CODE
    // ==========================================

    const duplicateGodown = await Godown.findOne({
      _id: { $ne: godownId },
      distributorId: godown.distributorId,
      godownCode: godownCode.trim(),
    });

    if (duplicateGodown) {
      return res.status(400).json({
        success: false,
        message: "Godown code already exists for this distributor",
      });
    }

    // ==========================================
    // UPDATE GODOWN
    // ==========================================

    godown.godownCode = godownCode.trim();
    godown.godownName = godownName.trim();

    if (godownType !== undefined) {
      godown.godownType = godownType;
    }

    if (location !== undefined) {
      godown.location = location;
    }

    if (contactPerson !== undefined) {
      godown.contactPerson = contactPerson;
    }

    if (isActive !== undefined) {
      godown.isActive = isActive;
    }

    if (remarks !== undefined) {
      godown.remarks = remarks;
    }

    await godown.save();

    // Populate distributor details
    const updatedGodown = await Godown.findById(godown._id).populate(
      "distributorId",
      "name dbCode"
    );

    return res.status(200).json({
      success: true,
      message: "Godown updated successfully",
      data: updatedGodown,
    });
  } catch (error) {
    console.error("Edit Godown Error:", error);

    // MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Godown code already exists for this distributor",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update godown",
      error: error.message,
    });
  }
});

module.exports = {
  editGodown,
};