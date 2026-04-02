const asyncHandler = require("express-async-handler");
const CreditNoteModel = require("../../models/creditNote.model");

const detailCreditNote = asyncHandler(async (req, res) => {
  try {
    const creditNote = await CreditNoteModel.findOne({
      _id: req.params.creditNoteId,
    }).populate([
      {
        path: "lineItems.product",
        select: "",
      },
      {
        path: "lineItems.inventoryId",
        select: "",
      },
      {
        path: "lineItems.price",
        select: "",
      },
      {
        path: "lineItems.adjustmentId",
        select: "",
      },
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "outletId",
        select: "",
      },
      { path: "billId", select: "" },
      { path: "salesReturnId", select: "" },
      { path: "adjustedBillIds.billId", select: "" },
      { path: "adjustedBillIds.orderId", select: "" },
      { path: "adjustedBillIds.collectionId", select: "" },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All credit note Data",
      data: creditNote,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = { detailCreditNote };
