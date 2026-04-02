const asyncHandler = require("express-async-handler");
const TransactionDraft = require("../../models/transactionDraft.model");

const allDraftList = asyncHandler(async (req, res) => {
  try {
    // Find the transaction draft by transactionDraftId and distributorId
    const transactionDraft = await TransactionDraft.find({
      "draft_data.distributorId": req.user?._id,
    }).populate([
      {
        path: "draft_data.distributorId",
        select: " ",
      },
      {
        path: "draft_data.productId",
        select: "name product_code",
      },
    ]);

    if (!transactionDraft) {
      return res.status(404).json({
        status: 404,
        message: "Transaction draft not found",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Transaction draft retrieved successfully",
      data: transactionDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { allDraftList };
