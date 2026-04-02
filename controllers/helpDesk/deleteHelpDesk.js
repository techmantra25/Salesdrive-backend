const HelpDesk = require("../../models/helpDesk.model");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const deleteHelpDesk = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid HelpDesk ID");
    }

    // Check if entry exists
    const helpDesk = await HelpDesk.findById(id);
    if (!helpDesk) {
      return res.status(404).json({
        status: 404,
        message: "HelpDesk entry not found",
      });
    }

    await HelpDesk.findByIdAndDelete(id);

    return res.status(200).json({
      status: 200,
      message: "HelpDesk entry deleted successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { deleteHelpDesk };
