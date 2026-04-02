const asyncHandler = require("express-async-handler");
const axios = require("axios");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const { SERVER_URL } = require("../../config/server.config");

// Helper function for date formatting
function getCurrentDateYYYYMMDD() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// Only update: approvedStatus, approved_by, approvedByType, updatedBy, updatedByType
const statusUpdateByEmp = asyncHandler(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const { approvedStatus, rejectedReason } = req.body;

  // Check if approvedStatus is provided
  if (typeof approvedStatus === "undefined") {
    return res.status(400).json({ message: "approvedStatus is required" });
  }

  // Find the purchase order by ID
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    return res.status(404).json({ message: "Purchase Order not found" });
  }

  // Determine updatedByType and approvedByType
  const updatedByType = req.user?.role === "admin" ? "User" : "Employee";
  const approvedByType = req.user?.role === "admin" ? "User" : "Employee";

  // Prepare update object
  const updateFields = {
    approvedStatus,
    rejectedReason,
    approved_by: req.user?._id || null,
    approvedByType,
    updatedBy: req.user?._id || null,
    updatedByType,
  };

  // Perform the update
  const updatedPurchaseOrder = await PurchaseOrder.findByIdAndUpdate(
    purchaseOrderId,
    { $set: updateFields },
    { new: true }
  );

  try {
    // hit the send quotation API
    await axios.get(
      `${SERVER_URL}/api/v1/purchase-order/send-quotation/${purchaseOrderId}`
    );
  } catch (error) {
    // make the approval status as Not Approved
    await PurchaseOrder.findByIdAndUpdate(
      purchaseOrderId,
      {
        $set: {
          approvedStatus: "Not Approved",
          approved_by: null,
          approvedByType: null,
          quotationSuccess: false,
        },
      },
      { new: true }
    );

    res.status(400);
    throw new Error(
      `Error sending quotation: ${
        error?.response?.data?.message || error.message
      }`
    );
  }

  // If not approved, send normal response
  return res.status(200).json({
    status: 200,
    message: "",
    data: updatedPurchaseOrder,
  });
});

module.exports = { statusUpdateByEmp };
