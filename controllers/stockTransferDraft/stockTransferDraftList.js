const asyncHandler = require("express-async-handler");
const StockTransferDraft = require("../../models/stockTransferDraft.model");

const stockTransferDraftList = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user?._id;

    // Unlike TransactionDraft, distributorId lives at the top level of
    // StockTransferDraft (not nested inside draft_data), so it's queried
    // directly rather than via a "draft_data.distributorId" path.
    const stockTransferDrafts = await StockTransferDraft.find({
      distributorId,
    })
      .sort({ createdAt: -1 })
      .populate([
        {
          path: "godownIdFrom",
          select: "godownName",
        },
        {
          path: "godownIdTo",
          select: "godownName",
        },
        {
          path: "draft_data.productId",
          select: "name product_code",
        },
        {
          path: "createdBy",
          select: "name email",
        },
      ]);

    return res.status(200).json({
      status: 200,
      message: "Stock transfer drafts retrieved successfully",
      data: stockTransferDrafts,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { stockTransferDraftList };