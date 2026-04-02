const asyncHandler = require("express-async-handler");
const DeliveryBoy = require("../../models/deliveryBoy.model");
const { deliveryBoyCodeGenerator } = require("../../utils/codeGenerator");

// Create DeliveryBoy
const createDeliveryBoy = asyncHandler(async (req, res) => {
  try {
    const { _id: distributorId } = req.user._id;
    const { name, mobileNo, address } = req.body;

    // Check if all required fields are present
    if (!name || !mobileNo || !address) {
      res.status(400);
      throw new Error("All fields are required");
    }

    const deliveryBoyCode = await deliveryBoyCodeGenerator("DVB");

    // Create a new delivery boy
    const deliveryBoy = await DeliveryBoy.create({
      name,
      distributorId,
      deliveryBoyCode: deliveryBoyCode,
      mobileNo,
      address,
    });

    // Respond with success message and data
    res.status(201).json({
      success: true,
      message: "Delivery boy created successfully",
      data: deliveryBoy,
    });
  } catch (error) {
    // Handle any potential errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createDeliveryBoy };
