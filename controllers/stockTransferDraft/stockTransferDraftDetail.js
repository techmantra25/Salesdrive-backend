const asyncHandler = require("express-async-handler");
const StockTransferDraft = require("../../models/stockTransferDraft.model");

const stockTransferDraftDetail = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user?._id;

    // Find the draft by transferDraftId, scoped to the requesting
    // distributor so one distributor can't view another's draft by
    // guessing the code.
    const stockTransferDraft = await StockTransferDraft.findOne({
      transferDraftId: req.params.transferDraftId,
      distributorId,
    }).populate([
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

    if (!stockTransferDraft) {
      return res.status(404).json({
        status: 404,
        message: "Stock Transfer Draft not found",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Stock Transfer Draft retrieved successfully",
      data: stockTransferDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { stockTransferDraftDetail };