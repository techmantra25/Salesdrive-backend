const asyncHandler = require("express-async-handler");
const TransactionDraft = require("../../models/transactionDraft.model");

// Delete the transaction draft based on the provided _id
const deleteDraft = asyncHandler(async (req, res) => {
  try {
    const { transactionDraftId } = req.params;
    const distributorId = req.user?._id;

    const deletedDraft = await TransactionDraft.findOneAndDelete({
      _id: transactionDraftId,
      "draft_data.distributorId": distributorId,
    });

    if (!deletedDraft) {
      return res.status(404).json({
        status: 404,
        message: "Transaction Draft not found",
      });
    }

    // Return success response
    res.status(200).json({
      status: 200,
      message: "Transaction Draft deleted successfully",
      data: deletedDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { deleteDraft };