const asyncHandler = require("express-async-handler");
const District = require("../../models/district.model");


// Assuming the bannerId is stored in req.params.bannerId from the URL route
const updateDistrict = asyncHandler(async (req, res) => {
  try {
    const did = req.params.did;

    // Check if the banner with the given bannerId exists
    const district = await District.findById(did);

    if (!district) {
      res.status(404);
      throw new Error("District not found");
    }

    // Update the banner data
    const updatedDistrict = await District.findOneAndUpdate(
      { _id: did },
      req.body,
      {
        new: true,
      }
    );

    // Return the updated banner data
    return res.status(200).json({
      status: 200,
      message: "District updated successfully",
      data: updatedDistrict,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Assuming the bannerId is stored in req.params.bannerId from the URL route

module.exports = { updateDistrict };
