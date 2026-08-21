const asyncHandler = require("express-async-handler");
const StockTransferDraft = require("../../models/stockTransferDraft.model");

// Delete the stock transfer draft based on the provided transferDraftId
const stockTransferDraftDelete = asyncHandler(async (req, res) => {
  try {
    const { transferDraftId } = req.params;
    const distributorId = req.user?._id;

    // Find and delete the draft by transferDraftId, scoped to the
    // requesting distributor so one distributor can't delete another's
    // draft by guessing the code.
    const deletedDraft = await StockTransferDraft.findOneAndDelete({
      transferDraftId,
      distributorId,
    });

    // If no draft is found, return 404
    if (!deletedDraft) {
      return res.status(404).json({
        status: 404,
        message: "Stock Transfer Draft not found",
      });
    }

    // Return success response
    res.status(200).json({
      status: 200,
      message: "Stock Transfer Draft deleted successfully",
      data: deletedDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { stockTransferDraftDelete };