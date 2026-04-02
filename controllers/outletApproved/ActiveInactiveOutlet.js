const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const activeInactiveOutlet = asyncHandler(async (req, res) => {
  const { outletId, status } = req.query;

  // -----------------------------
  // Basic validations
  // -----------------------------
  if (!outletId) {
    return res.status(400).json({
      success: false,
      message: "Outlet ID is required",
    });
  }

  if (status === undefined) {
    return res.status(400).json({
      success: false,
      message: "Status is required",
    });
  }

  // -----------------------------
  // Fetch outlet
  // -----------------------------
  const outletApproved = await OutletApproved.findById(outletId);

  if (!outletApproved) {
    return res.status(404).json({
      success: false,
      message: "Outlet not found",
    });
  }

  const newStatus = status === "true";

  // =========================================================
  // 🔒 ACTIVATE RULE
  // =========================================================
  if (newStatus) {
    const existingActiveOutlet = await OutletApproved.findOne({
      _id: { $ne: outletApproved._id }, // exclude current outlet
      mobile1: outletApproved.mobile1,
      status: true,
    });

    if (existingActiveOutlet) {
      return res.status(400).json({
        success: false,
        message:
          "Another active outlet already exists with this phone number.",
      });
    }
  }

  // =========================================================
  // 🔒 DEACTIVATE RULE
  // =========================================================
  if (!newStatus && outletApproved.currentPointBalance > 0) {
    return res.status(400).json({
      success: false,
      message:
        "Outlet Can not be deactivated. wallet balance exist.",
    });
  }

  // -----------------------------
  // Update status
  // -----------------------------
  outletApproved.status = newStatus;
  await outletApproved.save();

  // -----------------------------
  // Success response
  // -----------------------------
  return res.status(200).json({
    success: true,
    message: `Outlet ${
      newStatus ? "activated" : "deactivated"
    } successfully`,
  });
});

module.exports = { activeInactiveOutlet };
