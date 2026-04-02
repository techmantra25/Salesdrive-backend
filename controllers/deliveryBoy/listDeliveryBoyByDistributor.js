const asyncHandler = require("express-async-handler");
const DeliveryBoy = require("../../models/deliveryBoy.model");

// List DeliveryBoys by Distributor
const listDeliveryBoyByDistributor = asyncHandler(async (req, res) => {
  try {
    const { _id: distributorId } = req.user;

    // Fetch delivery boys associated with the distributor
    const deliveryBoys = await DeliveryBoy.find({ distributorId });

    // Respond with the list of delivery boys
    res.status(200).json({
      success: true,
      data: deliveryBoys,
    });
  } catch (error) {
    // Handle any potential errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listDeliveryBoyByDistributor };
