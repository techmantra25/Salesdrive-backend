const asyncHandler = require("express-async-handler");
const Plant = require("../../models/plant.model");

const updatePlant = asyncHandler(async (req, res) => {
  try {
    const plantId = req.params.pid;
    const {
      plantName,
      plantShortName,
      address,
      city,
      pinCode,
      stateId,
      salesOrganisation,
      status,
    } = req.body;

    const plantData = await Plant.findByIdAndUpdate(
      plantId,
      {
        plantName,
        plantShortName,
        address,
        city,
        pinCode,
        stateId,
        salesOrganisation,
        status,
      },
      {
        new: true,
      }
    );

    if (!plantData) {
      res.status(404);
      throw new Error("Plant not found");
    }

    // Return successful response
    return res.status(200).json({
      status: 200,
      message: "Plant updated successfully",
      data: plantData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Export the updatePlant function

module.exports = { updatePlant };
