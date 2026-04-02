const asyncHandler = require("express-async-handler");
const DeliveryBoy = require("../../models/deliveryBoy.model");

// Update DeliveryBoy
const updateDeliveryBoy = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobileNo, address, status } = req.body;

    // Find the delivery boy by ID and distributorId
    const deliveryBoy = await DeliveryBoy.findOne({ _id: id });

    if (!deliveryBoy) {
      res.status(404);
      throw new Error("Delivery boy not found");
    }

    // Update delivery boy's details
    deliveryBoy.name = name ?? deliveryBoy.name;
    deliveryBoy.mobileNo = mobileNo ?? deliveryBoy.mobileNo;
    deliveryBoy.address = address ?? deliveryBoy.address;
    deliveryBoy.status = status ?? deliveryBoy.status;

    // Save the updated delivery boy
    const updatedDeliveryBoy = await deliveryBoy.save();

    // Respond with success message and data
    res.status(200).json({
      success: true,
      message: "Delivery boy updated successfully",
      data: updatedDeliveryBoy,
    });
  } catch (error) {
    // Handle any potential errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateDeliveryBoy };
