const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");

const confirmPurchaseGRNeOrder = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;
    const { lineItems = [], status } = req.body;

  console.log("Received data for GRN confirmation:", lineItems);

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    let totalGross = 0;
    let totalGST = 0;
    let totalNet = 0;

    // ✅ Correct mapping using product ObjectId
    const updatedLineItems = purchaseOrder.lineItems.map((existingItem) => {
      const updatedItem = lineItems.find(
        (i) =>
          String(i.productId) === String(existingItem.product) // ✅ FIXED
      );

      if (!updatedItem) return existingItem;

      const grossAmt = Number(updatedItem.grossAmt || 0);
      const taxableAmt = Number(updatedItem.taxableAmt || grossAmt);
      const netAmt = Number(updatedItem.netAmt || 0);

      const gstAmt = netAmt - grossAmt;

      totalGross += grossAmt;
      totalGST += gstAmt;
      totalNet += netAmt;

      return {
        ...existingItem.toObject(),

        boxOrderQty: Number(updatedItem.boxOrderQty || 0),
        orderQty: Number(updatedItem.orderQty || 0),

        grossAmt,
        taxableAmt,

        // ✅ store GST properly
        totalIGST: existingItem.totalIGST || 0,
        totalCGST: existingItem.totalCGST || gstAmt / 2,
        totalSGST: existingItem.totalSGST || gstAmt / 2,

        netAmt,
      };
    });

    // ✅ Approval logic
    let config = {};
    try {
      const resConfig = await axios.get(
        `${SERVER_URL}/api/v1/config/get-config`
      );
      config = resConfig.data.data;
    } catch (error) {
      throw new Error(
        `Config error: ${
          error?.response?.data?.message || error.message
        }`
      );
    }

    let needApproval =
      config?.functionalSettings?.need_employee_approval_for_po ||
      "no approval";

    let approvedStatus = "Not Approved";
    let approved_by = null;

    if (needApproval === "no approval" && status === "Confirmed") {
      approvedStatus = "Approved";
      approved_by = req.user?._id || null;
    }

    if (status === "Cancelled") {
      approvedStatus = "Not Approved";
      approved_by = req.user?._id || null;
    }

    // ✅ FINAL DB UPDATE
    const updatedPurchaseOrder = await PurchaseOrder.findByIdAndUpdate(
      purchaseOrderId,
      {
        status,
        lineItems: updatedLineItems,

        grossAmount: totalGross,
        taxableAmount: totalGross,
        totalGSTAmount: totalGST,
        netAmount: totalNet,

        approvedStatus,
        approved_by,

        updatedBy: req.user?._id,
        updatedByType: "Distributor",
      },
      { new: true }
    );

    // ✅ Send quotation
    try {
      await axios.get(
        `${SERVER_URL}/api/v1/purchase-order/send-quotation/${purchaseOrderId}`
      );
    } catch (error) {
      await PurchaseOrder.findByIdAndUpdate(purchaseOrderId, {
        approvedStatus: "Not Approved",
        approved_by: null,
        quotationSuccess: false,
      });

      throw new Error(
        `Quotation error: ${
          error?.response?.data?.message || error.message
        }`
      );
    }

    res.status(200).json({
      message: "GRN Confirmed Successfulldfvcsdvy",
      data: updatedPurchaseOrder,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = { confirmPurchaseGRNeOrder };