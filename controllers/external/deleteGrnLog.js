const asyncHandler = require("express-async-handler");
const GrnLOG = require("../../models/grnLogSchema");
const mongoose = require("mongoose");

/**
 * Delete GRN log by _id
 * @route DELETE /api/v1/external/delete-grn-log/:id
 * @access Private (Admin only)
 */
const deleteGrnLog = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Valid GRN log ID is required");
    }

    // Find the GRN log
    const grnLog = await GrnLOG.findById(id);

    if (!grnLog) {
      return res.status(404).json({
        status: 404,
        message: "GRN log not found",
      });
    }

    // Delete the GRN log
    await GrnLOG.deleteOne({ _id: id });

    return res.status(200).json({
      status: 200,
      message: "GRN log deleted successfully",
      data: {
        deletedGrnLogId: id,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  deleteGrnLog,
};