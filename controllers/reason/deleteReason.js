const asyncHandler = require("express-async-handler");
const Reason = require("../../models/reason.model");

const reasonDelete = asyncHandler(async (req, res) => {
  try {
    // Finding and deleting the document
    let deletedReason = await Reason.findOneAndDelete({ _id: req.params.rid });

    if (!deletedReason) {
      return res.status(404).json({
        status: 404,
        message: "Reason not found",
      });
    }

    // Sending the response back after successful deletion
    return res.status(200).json({
      status: 200,
      message: "Reason deleted successfully",
      data: deletedReason,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { reasonDelete };
