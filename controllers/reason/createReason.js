const asyncHandler = require("express-async-handler");
const Reason = require("../../models/reason.model");

const createReason = asyncHandler(async (req, res) => {
  try {
    const { data, module } = req.body; // data array should have reasons

    // Validate data
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: 400,
        message: "Reason data is required and must be an array",
      });
    }

    if (!module) {
      return res.status(400).json({
        status: 400,
        message: "Module is required",
      });
    }

    // Map the data array to create reasons
    const reasonsToInsert = data.map((reasonText) => ({
      reason: reasonText,
      module,
    }));

    // Insert reasons in bulk using insertMany
    const ReasonData = await Reason.insertMany(reasonsToInsert);

    return res.status(201).json({
      status: 201,
      message: "Reasons created successfully",
      data: ReasonData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createReason };
