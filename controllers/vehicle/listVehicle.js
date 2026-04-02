const asyncHandler = require("express-async-handler");
const Vehicle = require("../../models/vehicle.model");

const listVehicle = asyncHandler(async (req, res) => {
  try {
    const vehicleData = await Vehicle.find({})
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

module.exports = { listVehicle };
