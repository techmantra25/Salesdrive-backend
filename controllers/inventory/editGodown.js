const asyncHandler = require("express-async-handler");
const Godown = require("../../models/godown.model");

const editGodown = asyncHandler(async (req, res) => {
  try {
    const { godownId } = req.params;

    const {
      godownCode,
      godownName,
      location,
      contactPerson,
      contactPersonNumber,
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
    // UPDATE ONLY CHANGED DATA
    // ==========================================

    let isChanged = false;

    // Godown Code
    if (godown.godownCode !== godownCode.trim()) {
      godown.godownCode = godownCode.trim();
      isChanged = true;
    }

    // Godown Name
    if (godown.godownName !== godownName.trim()) {
      godown.godownName = godownName.trim();
      isChanged = true;
    }

    // Location
    if (
      location !== undefined &&
      godown.location !== location
    ) {
      godown.location = location;
      isChanged = true;
    }

    // Contact Person
    if (
      contactPerson !== undefined &&
      godown.contactPerson !== contactPerson
    ) {
      godown.contactPerson = contactPerson;
      isChanged = true;
    }

    // Contact Person Number
    if (
      contactPersonNumber !== undefined &&
      godown.contactPersonNumber !== contactPersonNumber
    ) {
      godown.contactPersonNumber = contactPersonNumber;
      isChanged = true;
    }

    // Active Status
    if (
      isActive !== undefined &&
      godown.isActive !== isActive
    ) {
      godown.isActive = isActive;
      isChanged = true;
    }

    // Remarks
    if (
      remarks !== undefined &&
      godown.remarks !== remarks
    ) {
      godown.remarks = remarks;
      isChanged = true;
    }

    // ==========================================
    // NO CHANGES
    // ==========================================

    if (!isChanged) {
      return res.status(200).json({
        success: true,
        message: "No changes found",
        data: godown,
      });
    }

    // ==========================================
    // SAVE ONLY IF DATA CHANGED
    // ==========================================

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