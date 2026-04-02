const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");

const updateBeat = asyncHandler(async (req, res) => {
  console.log("Update Beat Request Body:", req.body);
  try {
    const { status, ...otherUpdates } = req.body; // Extract status and other updates from req.body

    // Find the beat to check if it has a distributor or employee
    let beat = await Beat.findById(req.params.bid).populate([
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "employeeId",
        select: "",
      },
    ]);

    if (!beat) {
      res.status(404);
      throw new Error("Beat not found");
    }


    // Only block status update if employee exists
    if (
      Array.isArray(beat?.employeeId) &&
      beat.employeeId.length > 0 &&
      status !== undefined
    ) {
      return res.status(200).json({
        error: false,
        statusUpdateError: true,
        message:
          "Beat is assigned to employee(s), status cannot be updated",
      });
    }


    // Handle distributorId updates (ensure it's an array)
    if (otherUpdates.distributorId !== undefined) {
      otherUpdates.distributorId = Array.isArray(otherUpdates.distributorId)
        ? otherUpdates.distributorId
        : otherUpdates.distributorId
          ? [otherUpdates.distributorId]
          : [];
    }

    // Proceed with the update (excluding the status if it shouldn't be updated)
    const updatedBeat = await Beat.findOneAndUpdate(
      { _id: req.params.bid },
      { ...otherUpdates, ...(status !== undefined ? { status } : {}) }, // Update status if allowed
      { new: true }
    );

    if (updatedBeat) {
      return res.status(201).json({
        status: 201,
        message: "Beat updated successfully",
        data: updatedBeat,
      });
    } else {
      res.status(500);
      throw new Error("Beat not updated");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateBeat };
