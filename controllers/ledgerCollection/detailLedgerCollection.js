const asyncHandler = require("express-async-handler");
const LedgerCollection = require("../../models/ledgerCollection.model");

const detailLedgerCollection = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const ledgerCollection = await LedgerCollection.findById(id).populate([
      {
        path: "lineItems.billId",
        select: "",
        populate: [
          {
            path: "retailerId",
            select: "",
          },
        ],
      },
      {
        path: "lineItems.creditNoteAdjusted.creditNoteId",
        select: "",
      },
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "retailerId",
        select: "",
      },
    ]);
    if (!ledgerCollection) {
      return res.status(404).json({
        success: false,
        message: "Ledger collection not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Ledger collection found",
      data: ledgerCollection,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { detailLedgerCollection };
