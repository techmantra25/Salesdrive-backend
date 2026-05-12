const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const StockLedger = require("../../models/stockLedger.model");

const findNegativeClosingStockByProduct = asyncHandler(async (req, res) => {
  const { distributorId } = req.body;

  if (!distributorId) {
    res.status(400);
    throw new Error("distributorId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(distributorId)) {
    res.status(400);
    throw new Error("Invalid distributorId");
  }

  const distributorObjectId = new mongoose.Types.ObjectId(distributorId);

  const negativeStockReport = await StockLedger.aggregate([
    {
      $match: {
        distributorId: distributorObjectId,
        closingStock: { $lt: 0 },
        qtyChange: { $lt: 0 },
      },
    },
    {
      $addFields: {
        currentNegativeQty: { $abs: "$closingStock" },
        qtyMadeNegative: {
          $cond: [
            { $lt: ["$qtyChange", 0] },
            { $abs: "$qtyChange" },
            0,
          ],
        },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $unwind: {
        path: "$product",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        productId: 1,
        date: 1,
        _id: 1,
      },
    },
    {
      $group: {
        _id: "$productId",
        productId: { $first: "$productId" },
        productName: { $first: "$product.name" },
        productCode: { $first: "$product.product_code" },
        stock_id: {
          $push: {
            _id: "$_id",
            transactionId: "$transactionId",
            date: "$date",
            openingStock: "$openingStock",
            transactionType: "$transactionType",
            qtyChange: "$qtyChange",
            closingStock: "$closingStock",
            qtyMadeNegative: "$qtyMadeNegative",
          },
        },
        negativeEntryCount: { $sum: 1 },
        totalQtyMadeNegative: { $sum: "$qtyMadeNegative" },
        latestNegativeQty: { $last: "$currentNegativeQty" },
      },
    },
    {
      $project: {
        _id: 0,
        productId: 1,
        productName: 1,
        productCode: 1,
        totalQtyMadeNegative: 1,
        stock_id: 1,
      },
    },
    {
      $sort: {
        totalQtyMadeNegative: -1,
        productName: 1,
      },
    },
  ]);

  const summary = negativeStockReport.reduce(
    (acc, productReport) => {
      acc.productsWithNegativeStock += 1;
      acc.totalNegativeEntries += productReport.stock_id.length;
      acc.totalQtyMadeNegative += productReport.totalQtyMadeNegative;
      return acc;
    },
    {
      productsWithNegativeStock: 0,
      totalNegativeEntries: 0,
      totalQtyMadeNegative: 0,
    },
  );

  return res.status(200).json({
    success: true,
    message: "Negative closing stock report fetched successfully",
    data: {
      distributorId,
      summary,
      products: negativeStockReport,
    },
  });
});

module.exports = { findNegativeClosingStockByProduct };
