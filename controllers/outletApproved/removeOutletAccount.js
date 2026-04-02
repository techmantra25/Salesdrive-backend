const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const removeOutletAccount = asyncHandler(async (req, res) => {
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

    // Update the outlet to mark as removed
    const updatedOutlet = await OutletApproved.findByIdAndUpdate(
      outletApprovedId,
      {
        status: false,
        deletedByApp: true,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      error: false,
      message: "Outlet account removed successfully",
      updatedOutlet,
    });
  } catch (error) {
    console.error("Remove Outlet Account Error:", error);
    res.status(500).json({
      error: true,
      message: "Internal server error",
      details: error.message,
    });
  }
});

module.exports = removeOutletAccount;