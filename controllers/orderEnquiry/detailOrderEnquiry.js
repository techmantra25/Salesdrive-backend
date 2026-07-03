const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

const detailOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const orderEnquiry = await OrderEnquiry.findById(req.params.id).populate([
      { path: "distributorId", select: "" },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      {
        path: "retailerId",
        select: "",
        populate: [
          {
            path: "stateId",
            select: "",
            populate: { path: "zoneId", select: "" },
          },
          { path: "regionId", select: "" },
          { path: "beatId", select: "" },
        ],
      },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" },
      { path: "convertedOrderEntryId", select: "" },
      {
        path: "adjustedCreditNoteIds.creditNoteId",
        model: "CreditNote",
        select:
          "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
      },
    ]);

    if (!orderEnquiry) {
      res.status(404);
      throw new Error("Order Enquiry not found");
    }


    const responseData = orderEnquiry.toObject();

    responseData.createdAt = responseData.manualDate;
    return res.status(200).json({
      status: 200,
      message: "Order Enquiry details retrieved successfully",
      data: responseData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailOrderEnquiry };
