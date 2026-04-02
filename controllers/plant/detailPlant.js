const asyncHandler = require("express-async-handler");
const Plant = require("../../models/plant.model");

const detailPlant = asyncHandler(async (req, res) => {
  try {
    const plantId = req.params.pid;

    const plantData = await Plant.findById(plantId).populate([
      {
        path: "stateId",
        select: "",
      },
    ]);

    if (!plantData) {
      res.status(404);
      throw new Error("Plant not found");
    }

    // Return successful response
    return res.status(200).json({
      status: 200,
      message: "Plant details fetched successfully",
      data: plantData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Export the detailSupplier function

module.exports = { detailPlant };
