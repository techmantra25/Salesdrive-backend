const asyncHandler = require("express-async-handler");
const SalesReturnModel = require("../../models/salesReturn.model");

const detailSalesReturn = asyncHandler(async (req, res) => {
  try {
    const salesReturn = await SalesReturnModel.findOne({
      _id: req.params.salesReturnId,
    }).populate([
      { path: "distributorId", select: "" },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      { path: "billId", select: "" }, // Fetching billNo and orderNo
      { path: "retailerId", select: "" },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All sales return Data",
      data: salesReturn,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = { detailSalesReturn };
