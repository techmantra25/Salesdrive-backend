const asyncHandler = require("express-async-handler");
const Vehicle = require("../../models/vehicle.model");

const createVehicle = asyncHandler(async (req, res) => {
  try {
    const { name, type, vehicle_no, capacity, capacity_unit } = req.body;

    const vehicleData = new Vehicle({
      name,
      type,
      vehicle_no,
      capacity,
      capacity_unit,
      distributorId: req.user._id,
    });

    const vehicle = await vehicleData.save();

    res.status(200).json({
      status: 200,
      message: "Vehicle created successfully",
      data: vehicle,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { createVehicle };
