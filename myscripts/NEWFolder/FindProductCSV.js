const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const mongoose = require("mongoose");
const Product = require("../../models/product.model");
const StockLedger = require("../../models/stockLedger.model");
const {
  getAllNegativeStockDistributorIds,
} = require("./FindDistributorWithNegativeStock");

function parseDistributorIds(distributorIds) {
  if (Array.isArray(distributorIds)) {
    return distributorIds;
  }

  if (typeof distributorIds === "string") {
    return distributorIds
      .split(",")
      .map((distributorId) => distributorId.trim())
      .filter(Boolean);
  }

  return [];
}

function getDistributorIds(req) {
  const body = req.body || {};

  if (Array.isArray(body)) {
    return parseDistributorIds(body);
  }

  if (typeof body === "string") {
    try {
      return parseDistributorIds(JSON.parse(body).distributorIds);
    } catch (error) {
      return parseDistributorIds(body);
    }
  }

  return parseDistributorIds(
    body.distributorIds ||
      body.distributorId ||
      body.data?.distributorIds ||
      req.query?.distributorIds,
  );
}

const findNegativeClosingStockByProductForDistributors = asyncHandler(
  async (req, res) => {
    let distributorIds = getDistributorIds(req);

    if (!distributorIds.length) {
      distributorIds = (await getAllNegativeStockDistributorIds()).map(
        (distributorId) => distributorId.toString(),
      );
    }

    const invalidDistributorId = distributorIds.find(
      (distributorId) => !mongoose.Types.ObjectId.isValid(distributorId),
    );

    if (invalidDistributorId) {
      res.status(400);
      throw new Error(`Invalid distributorId: ${invalidDistributorId}`);
    }

    const distributorObjectIds = distributorIds.map(
      (distributorId) => new mongoose.Types.ObjectId(distributorId),
    );

    const negativeStockReport = await StockLedger.aggregate([
      {
        $match: {
          distributorId: { $in: distributorObjectIds },
          closingStock: { $lt: 0 },
          qtyChange: { $lt: 0 },
        },
      },
      {
        $addFields: {
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
          totalQtyMadeNegative: { $sum: "$qtyMadeNegative" },
          negativeEntryCount: { $sum: 1 },
          latestNegativeClosingStock: { $last: "$closingStock" },
          latestNegativeDate: { $last: "$date" },
        },
      },
      {
        $project: {
          _id: 0,
          distributorId: 1,
          distributorName: 1,
          distributorDbCode: 1,
          productId: 1,
          totalQtyMadeNegative: 1,
          negativeEntryCount: 1,
          latestNegativeClosingStock: 1,
          latestNegativeDate: 1,
        },
      },
      {
        $sort: {
          distributorDbCode: 1,
          totalQtyMadeNegative: -1,
        },
      },
    ]);

    const productIds = [
      ...new Set(
        negativeStockReport.map((stockReport) =>
          stockReport.productId.toString(),
        ),
      ),
    ];
    const products = await Product.find({ _id: { $in: productIds } })
      .select("name product_code")
      .lean();
    const productById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );

    const productsWithNegativeStock = negativeStockReport.map((stockReport) => {
      const product = productById.get(stockReport.productId.toString());

      return {
        "Distributor Name": stockReport.distributorName || "",
        "Distributor DB Code": stockReport.distributorDbCode || "",
        "Product Name": product?.name || "",
        "Product Code": product?.product_code || "",
        "Total Qty Made Negative": stockReport.totalQtyMadeNegative,
      };
    });

    const fileName = `negative-closing-stock-report-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({
      headers: [
        "Distributor Name",
        "Distributor DB Code",
        "Product Name",
        "Product Code",
        "Total Qty Made Negative",
      ],
    });

    csvStream.pipe(res);
    productsWithNegativeStock.forEach((product) => csvStream.write(product));
    csvStream.end();
  },
);

module.exports = { findNegativeClosingStockByProductForDistributors };
