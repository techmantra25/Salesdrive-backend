const asyncHandler = require("express-async-handler");
const DeliveryBoy = require("../../models/deliveryBoy.model");

// Get DeliveryBoy Details
const detailDeliveryBoy = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Find the delivery boy by ID and distributorId
    const deliveryBoy = await DeliveryBoy.findOne({ _id: id });

    if (!deliveryBoy) {
      res.status(404);
      throw new Error("Delivery boy not found");
    }

    // Respond with delivery boy details
    res.status(200).json({
      success: true,
      data: deliveryBoy,
    });
  } catch (error) {
    // Handle any potential errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailDeliveryBoy };
