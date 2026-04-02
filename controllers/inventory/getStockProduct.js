const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const getInTransitQty = require("../../utils/getInTransitQty");
const Invoice = require("../../models/invoice.model");

const getStockProduct = asyncHandler(async (req, res) => {
  try {
    const { productId } = req?.params;
    const { distributorId } = req?.query;

    const response = await Inventory.findOne({
      productId: productId,
      distributorId: distributorId,
      godownType: "main",
    }).lean();

    const inTransitInvoices = await Invoice.find({
      distributorId: distributorId,
      status: "In-Transit",
    }).populate("lineItems.product");

    const intransitQty = getInTransitQty(
      inTransitInvoices,
      response?.productId
    );

    let result = {
      ...response,
      intransitQty: intransitQty,
    };

    res.status(200).json({
      status: true,
      message: "Stock product fetched successfully",
      data: result,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { getStockProduct };
