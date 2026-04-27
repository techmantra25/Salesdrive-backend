const PurchaseOrderEntry = require("../../models/purchaseOrder.model");

exports.addSoNumberToOrder = async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;
    const { soNumber } = req.body;
console.log("Received SO Number:", soNumber, "for Order ID:", purchaseOrderId);
    if (!purchaseOrderId || !soNumber) {
      return res.status(400).json({
        success: false,
        message: "purchaseOrderId and soNumber are required",
      });
    }

    // ✅ Check duplicate
    const exists = await PurchaseOrderEntry.findOne({ soNumber });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "SO Number already exists",
      });
    }

    const updatedOrder = await PurchaseOrderEntry.findByIdAndUpdate(
      purchaseOrderId,
      { soNumber }, // ✅ direct root update
      { new: true }
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
    // ✅ handle duplicate index error
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