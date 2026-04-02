const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");

//detail bill
const detailBill = asyncHandler(async (req, res) => {
  try {
    const { billId } = req.params;
    const bill = await Bill.findById(billId).populate([
      {
        path: "distributorId",
        select: "",
        populate: [
          {
            path: "stateId",
            select: "",
          },
          {
            path: "brandId",
            select: "",
          },
        ],
      },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      { path: "orderId", select: "" },
      { path: "retailerId", select: "" },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" },
      {
        path: "loadSheetId",
        select: "allocationNo createdAt",
        populate: {
          path: "vehicleId",
          select: "name vehicle_no ",
        },
      },
      {
        path: "salesReturnId",
        select: "",
        populate: {
          path: "lineItems.product",
          select: "",
        },
      },
      { path: "adjustedCreditNoteIds.creditNoteId", select: "" },
      { path: "adjustedReplacementIds.replacementId", select: "" },
      { path: "creditNoteId", select: "" },
      { path: "replacementId", select: "" },
      { path: "salesReturnId", select: "" },
      {
        path: "loadSheetId",
        select: "",
        populate: {
          path: "vehicleId",
          select: "",
        },
      },
      { path: "ledgerCollectionId", select: "" },
    ]);
    return res.status(201).json({
      status: 201,
      message: "Bill detail",
      data: bill,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailBill };
