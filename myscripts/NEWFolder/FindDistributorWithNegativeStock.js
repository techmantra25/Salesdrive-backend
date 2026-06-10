const asyncHandler = require("express-async-handler");
const StockLedger = require("../../models/stockLedger.model");

async function getAllNegativeStockDistributorIds() {
  return StockLedger.distinct("distributorId", {
    closingStock: { $lt: 0 },
  });
}

const findDistributorWithNegativeStock = asyncHandler(async (req, res) => {
  const negativeDistributorReport = await StockLedger.aggregate([
    {
      $match: {
        closingStock: { $lt: 0 },
      },
    },
    {
      $lookup: {
        from: "distributors",
        localField: "distributorId",
        foreignField: "_id",
        as: "distributor",
      },
    },
    {
      $unwind: {
        path: "$distributor",
        preserveNullAndEmptyArrays: true,
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
        distributorId: 1,
        productId: 1,
        date: 1,
        _id: 1,
      },
    },
    {
      $group: {
        _id: {
          distributorId: "$distributorId",
          productId: "$productId",
        },
        distributorId: { $first: "$distributorId" },
        distributorName: { $first: "$distributor.name" },
        distributorDbCode: { $first: "$distributor.dbCode" },
        productId: { $first: "$productId" },
        productCode: { $first: "$product.product_code" },
        negativeEntryCount: { $sum: 1 },
        mostNegativeClosingStock: { $min: "$closingStock" },
        latestNegativeClosingStock: { $last: "$closingStock" },
        latestNegativeDate: { $last: "$date" },
      },
    },
    {
      $group: {
        _id: "$distributorId",
        distributorId: { $first: "$distributorId" },
        distributorName: { $first: "$distributorName" },
        distributorDbCode: { $first: "$distributorDbCode" },
        productsWithNegativeStock: { $sum: 1 },
        totalNegativeEntries: { $sum: "$negativeEntryCount" },
        mostNegativeClosingStock: { $min: "$mostNegativeClosingStock" },
        latestNegativeDate: { $max: "$latestNegativeDate" },
        products: {
          $push: {
            productId: "$productId",
            productCode: "$productCode",
            negativeEntryCount: "$negativeEntryCount",
            mostNegativeClosingStock: "$mostNegativeClosingStock",
            latestNegativeClosingStock: "$latestNegativeClosingStock",
            latestNegativeDate: "$latestNegativeDate",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        distributorId: 1,
        distributorName: 1,
        distributorDbCode: 1,
        productsWithNegativeStock: 1,
        totalNegativeEntries: 1,
        mostNegativeClosingStock: 1,
        latestNegativeDate: 1,
        products: 1,
      },
    },
    {
      $sort: {
        productsWithNegativeStock: -1,
        totalNegativeEntries: -1,
        distributorName: 1,
      },
    },
  ]);

  const summary = negativeDistributorReport.reduce(
    (acc, distributorReport) => {
      acc.distributorsWithNegativeStock += 1;
      acc.productsWithNegativeStock +=
        distributorReport.productsWithNegativeStock;
      acc.totalNegativeEntries += distributorReport.totalNegativeEntries;

      if (distributorReport.distributorDbCode) {
        acc.allDistributorCodes.push(distributorReport.distributorDbCode);
      }

      if (distributorReport.distributorId) {
        acc.allDistributorIds.push(distributorReport.distributorId);
      }

      return acc;
    },
    {
      distributorsWithNegativeStock: 0,
      productsWithNegativeStock: 0,
      totalNegativeEntries: 0,
      allDistributorCodes: [],
      allDistributorIds: [],
    },
  );

  return res.status(200).json({
    success: true,
    message: "Distributors with negative closing stock fetched successfully",
    data: {
      summary,
      distributors: negativeDistributorReport,
    },
  });
});

module.exports = {
  findDistributorWithNegativeStock,
  getAllNegativeStockDistributorIds,
};
