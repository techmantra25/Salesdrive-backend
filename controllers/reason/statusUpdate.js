const asyncHandler = require("express-async-handler");
const Reason = require("../../models/reason.model");

const reasonstatusUpdate = asyncHandler(async (req, res) => {
  try {
    // Finding and updating the document
    let updatedReason = await Reason.findOneAndUpdate(
      { _id: req.params.rid },
      { status: req.body.status },
      { new: true } // Return the updated document
    );

    if (!updatedReason) {
      return res.status(404).json({
        status: 404,
        message: "Reason not found",
      });
    }

    // Sending the response back with the updated Reason
    return res.status(200).json({
      status: 200,
      message: "Reason status updated successfully",
      data: updatedReason,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { reasonstatusUpdate };
