const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");

// Update Purchase Order by Employee or Admin
const updatePurchaseOrderByEmp = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    // Remove forbidden fields
    const disallowedFields = ["status", "approved_by", "approvedStatus"];
    disallowedFields.forEach((field) => {
      if (field in req.body) {
        delete req.body[field];
      }
    });

    // Determine updatedByType
    const updatedByType = req.user?.role === "admin" ? "User" : "Employee";

    // Add audit fields
    req.body.updatedByType = updatedByType;
    req.body.updatedBy = req.user?._id || null;

    const updatedPurchaseOrder = await PurchaseOrder.findOneAndUpdate(
      { _id: purchaseOrderId },
      req.body,
      { new: true }
    );

    res.status(200).json({
      status: 200,
      message: "Purchase Order updated successfully",
      data: updatedPurchaseOrder,
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = { updatePurchaseOrderByEmp };
