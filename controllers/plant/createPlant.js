const asyncHandler = require("express-async-handler");
const Plant = require("../../models/plant.model");

const createPlant = asyncHandler(async (req, res) => {
  try {
    const {
      plantCode,
      plantName,
      plantShortName,
      address,
      city,
      pinCode,
      stateId,
      salesOrganisation,
      status,
    } = req.body;

    // Check if a plant`` with the same plantcode exists
    let plantExist = await Plant.findOne({
      plantCode: plantCode,
    });

    if (plantExist) {
      res.status(400);
      throw new Error("Plant already exists");
    }

    // Create new Plant data
    const plantData = await Plant.create({
      plantCode,
      plantName,
      plantShortName,
      address,
      city,
      pinCode,
      stateId,
      salesOrganisation,
      status,
    });

    // Return successful response
    return res.status(201).json({
      status: 201,
      message: "Plant created successfully",
      data: plantData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createPlant };
