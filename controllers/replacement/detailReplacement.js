const asyncHandler = require("express-async-handler");
const Replacement = require("../../models/replacement.model");

const detailReplacement = asyncHandler(async (req, res) => {
  try {
    const creditNote = await Replacement.findOne({
      _id: req.params.replacementId,
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
    ]);

    return res.status(201).json({
      status: 201,
      message: "All replacement data",
      data: creditNote,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = { detailReplacement };
