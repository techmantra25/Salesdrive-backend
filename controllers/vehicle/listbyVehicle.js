const asyncHandler = require("express-async-handler");
const Vehicle = require("../../models/vehicle.model");

const listbyVehicle = asyncHandler(async (req, res) => {
  try {
    const vehicleData = await Vehicle.find({ distributorId: req.user._id })
      .populate([
        {
          path: "distributorId",
          select: "name dbCode role",
        },
      ])
      .sort({ createdAt: -1 });

    return res.status(200).json({
      status: 200,
      message: "Vehicle list retrieved successfully",
      data: vehicleData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listbyVehicle };
