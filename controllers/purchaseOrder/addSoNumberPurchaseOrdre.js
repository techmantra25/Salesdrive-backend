const PurchaseOrderEntry = require("../../models/purchaseOrder.model");

exports.addSoNumberToOrder = async (req, res) => {
  try {
    // The frontend currently sends the payload wrapped one level too deep —
    // { soNumber: { purchaseOrderId, lineItemIds, soNumber } } — instead of
    // { purchaseOrderId, lineItemIds, soNumber } directly. This normalizes
    // both shapes so the endpoint works regardless, until the frontend
    // wrapping bug (in addSoNumberToPurchaseOrder in api/purchaseOrder.js)
    // is fixed.
    const body =
      req.body?.soNumber && typeof req.body.soNumber === "object"
        ? req.body.soNumber
        : req.body;

    const purchaseOrderId = req.params.purchaseOrderId || body.purchaseOrderId;
    const { lineItemIds } = body;
    const soNumber = body.soNumber;

    if (
      !purchaseOrderId ||
      !soNumber ||
      typeof soNumber !== "string" ||
      !Array.isArray(lineItemIds) ||
      lineItemIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "purchaseOrderId, soNumber and at least one lineItemId are required",
      });
    }

    // Check duplicate across ALL line items (any PO), since soNumber lives
    // per line item rather than on the PO root.
    const exists = await PurchaseOrderEntry.findOne({
      "lineItems.soNumber": soNumber,
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "SO Number already exists",
      });
    }

    // Set the same soNumber on every selected line item only.
    const updatedOrder = await PurchaseOrderEntry.findOneAndUpdate(
      { _id: purchaseOrderId },
      { $set: { "lineItems.$[elem].soNumber": soNumber } },
      {
        new: true,
        arrayFilters: [{ "elem._id": { $in: lineItemIds } }],
      }
    );

    if (!updatedOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "SO Number added successfully",
      data: updatedOrder,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "SO Number must be unique",
      });
    }

    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};