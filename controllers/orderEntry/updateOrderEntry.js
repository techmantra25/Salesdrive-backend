const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

// Update Order Entry
const updateOrderEntry = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const updatedOrderEntry = await OrderEntry.findOneAndUpdate(
      { _id: id },
      req.body,
      { new: true }
    );

    if (!updatedOrderEntry) {
      return res.status(404).json({
        status: 404,
        message: "Order Entry not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Order Entry updated successfully",
      data: updatedOrderEntry,
    });
  } catch (error) {
    res.status(400).json({
      status: 400,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = { updateOrderEntry };
