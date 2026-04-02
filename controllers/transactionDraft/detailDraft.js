const asyncHandler = require("express-async-handler");
const TransactionDraft = require("../../models/transactionDraft.model");

const detailDraft = asyncHandler(async (req, res) => {
  try {
    // Find the transaction by transactionId and distributorId
    const transactionDraft = await TransactionDraft.findOne({
      _id: req.params.transactionDraftId,
    }).populate([
      {
        path: "draft_data.distributorId",
        select: "name email", // Adjust as per your Distributor model fields
      },
      {
        path: "draft_data.productId",
        select: "name product_code", // Adjust as per your Product model fields
      },
    ]);

    if (!transactionDraft) {
      return res.status(404).json({
        status: 404,
        message: "Transaction draft not found", // Adjust as per your error message
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Transaction Draft retrieved successfully",
      data: transactionDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailDraft };
