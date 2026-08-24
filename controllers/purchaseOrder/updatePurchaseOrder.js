const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");

// FIX: "plant" is no longer required/used for Purchase Order line items.
// Previously, if a line item had no plant assigned, the frontend sent
// plant: "" (empty string), and Mongoose threw:
//   "Cast to embedded failed for value ... plant: '' ... CastError"
// because it tried (and failed) to cast "" to an ObjectId.
// This helper strips out any plant value that isn't a valid ObjectId
// (including "", null, undefined) so Mongoose never attempts that cast,
// regardless of what the schema says.
const sanitizeLineItems = (lineItems) => {
  if (!Array.isArray(lineItems)) return lineItems;

  return lineItems.map((item) => {
    const cleaned = { ...item };

    if (
      !cleaned.plant ||
      !mongoose.Types.ObjectId.isValid(cleaned.plant)
    ) {
      // Remove the key entirely instead of setting null, so it doesn't
      // even get sent to Mongoose for casting.
      delete cleaned.plant;
    }

    return cleaned;
  });
};

// Update Purchase Order
const updatePurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    // Add updater info to body
    req.body.updatedByType = "Distributor";
    req.body.updatedBy = req.user?._id || null;

    // FIX: strip out invalid/empty "plant" values from line items so the
    // update never throws a CastError on that field.
    if (req.body.lineItems) {
      req.body.lineItems = sanitizeLineItems(req.body.lineItems);
    }

    let status = req.body.status || purchaseOrder.status;
    let config = {};
    try {
      config = await axios.get(`${SERVER_URL}/api/v1/config/get-config`);
      config = config.data.data;
    } catch (error) {
      res.status(400);
      throw new Error(
        `Error fetching config details: ${
          error?.response?.data?.message || error.message
        }`
      );
    }

    let need_employee_approval_for_po =
      config?.functionalSettings?.need_employee_approval_for_po ||
      "no approval";

    let approvedStatus = "Not Approved";
    let approved_by = null;

    if (
      need_employee_approval_for_po === "no approval" &&
      status === "Confirmed"
    ) {
      approvedStatus = "Approved";
      approved_by = req?.user?._id || null;
    }

    if (
      need_employee_approval_for_po === "agent approval" ||
      need_employee_approval_for_po === "admin approval"
    ) {
      approvedStatus = "Not Approved";
      approved_by = null;
    }

    if (status === "Cancelled") {
      approvedStatus = "Not Approved";
      approved_by = req?.user?._id || null;
    }

    req.body.approvedStatus = approvedStatus;
    req.body.approved_by = approved_by;

    // Update the purchase order
    const updatedPurchaseOrder = await PurchaseOrder.findOneAndUpdate(
      { _id: purchaseOrderId },
      req.body,
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

    res.status(200).json({
      status: 200,
      message: "Purchase Order updated successfully",
      data: updatedPurchaseOrder,
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = { updatePurchaseOrder };