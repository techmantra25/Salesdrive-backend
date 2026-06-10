const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Distributor = require("../../models/distributor.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const StockLedger = require("../../models/stockLedger.model");
const Transaction = require("../../models/transaction.model");
const { transactionCode } = require("../../utils/codeGenerator");

function getBalanceCount(inventoryDoc, stockType) {
  return stockType === "salable"
    ? inventoryDoc.availableQty
    : inventoryDoc.unsalableQty;
}

async function getOpeningStockDate(distributorId) {
  const openingStockTransaction = await Transaction.findOne({
    distributorId,
    transactionType: "openingstock",
  })
    .sort({ date: 1, createdAt: 1 })
    .select("date createdAt")
    .lean();

  if (openingStockTransaction) {
    return openingStockTransaction.date || openingStockTransaction.createdAt;
  }

  const distributor = await Distributor.findById(distributorId)
    .select("createdAt")
    .lean();

  return distributor?.createdAt || new Date();
}

async function getNegativeStockProducts(distributorId) {
  return StockLedger.aggregate([
    {
      $match: {
        distributorId,
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
        totalQtyMadeNegative: { $sum: "$qtyMadeNegative" },
      },
    },
    {
      $project: {
        _id: 0,
        productId: 1,
        productName: 1,
        productCode: 1,
        totalQtyMadeNegative: 1,
      },
    },
    {
      $sort: {
        totalQtyMadeNegative: -1,
        productName: 1,
      },
    },
  ]);
}

const fixNegativeStocks = asyncHandler(async (req, res) => {
  const { distributorId, stockType = "salable", productIds = [] } = req.body;

  if (!distributorId) {
    res.status(400);
    throw new Error("distributorId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(distributorId)) {
    res.status(400);
    throw new Error("Invalid distributorId");
  }

  if (!["salable", "unsalable"].includes(stockType)) {
    res.status(400);
    throw new Error("stockType must be salable or unsalable");
  }

  const invalidProductId = productIds.find(
    (productId) => !mongoose.Types.ObjectId.isValid(productId),
  );

  if (invalidProductId) {
    res.status(400);
    throw new Error(`Invalid productId: ${invalidProductId}`);
  }

  const distributorObjectId = new mongoose.Types.ObjectId(distributorId);
  const requestedProductIds = productIds.map(
    (productId) => new mongoose.Types.ObjectId(productId),
  );
  const requestedProductIdSet = new Set(
    requestedProductIds.map((productId) => productId.toString()),
  );

  const openingStockDate = await getOpeningStockDate(distributorObjectId);
  const negativeStockProducts = await getNegativeStockProducts(
    distributorObjectId,
  );
  const productsToFix = requestedProductIdSet.size
    ? negativeStockProducts.filter((product) =>
        requestedProductIdSet.has(product.productId.toString()),
      )
    : negativeStockProducts;

  const summary = {
    prepared: 0,
    inserted: 0,
    skipped: [],
    errors: [],
  };
  const insertedTransactions = [];

  for (const productReport of productsToFix) {
    try {
      const qty = Number(productReport.totalQtyMadeNegative || 0);

      if (qty <= 0) {
        summary.skipped.push({
          productId: productReport.productId,
          productCode: productReport.productCode,
          reason: `Invalid totalQtyMadeNegative: ${qty}`,
        });
        continue;
      }

      const inventoryDoc = await Inventory.findOne({
        distributorId: distributorObjectId,
        productId: productReport.productId,
      });

      if (!inventoryDoc) {
        summary.skipped.push({
          productId: productReport.productId,
          productCode: productReport.productCode,
          reason: "Inventory item not found",
        });
        continue;
      }

      const existingProductOpeningStock = await Transaction.findOne({
        distributorId: distributorObjectId,
        productId: productReport.productId,
        invItemId: inventoryDoc._id,
        transactionType: "openingstock",
        stockType,
        type: "In",
      })
        .select("transactionId")
        .lean();

      if (existingProductOpeningStock) {
        summary.skipped.push({
          productId: productReport.productId,
          productCode: productReport.productCode,
          reason: `Opening stock transaction already exists: ${existingProductOpeningStock.transactionId}`,
        });
        continue;
      }

      const productDoc =
        productReport.productName && productReport.productCode
          ? null
          : await Product.findById(productReport.productId)
              .select("name product_code")
              .lean();
      const productName =
        productReport.productName || productDoc?.name || productReport.productId;
      const productCode =
        productReport.productCode || productDoc?.product_code || "-";

      summary.prepared++;

      const payload = {
        distributorId: distributorObjectId,
        productId: productReport.productId,
        transactionId: await transactionCode("LXSTA"),
        invItemId: inventoryDoc._id,
        qty,
        date: openingStockDate,
        type: "In",
        balanceCount: getBalanceCount(inventoryDoc, stockType),
        description: `Opening stock for ${productCode}`,
        transactionType: "openingstock",
        stockType,
        createdAt: openingStockDate,
        updatedAt: openingStockDate,
      };

      const transaction = await Transaction.create(payload);
      summary.inserted++;
      insertedTransactions.push({
        _id: transaction._id,
        transactionId: transaction.transactionId,
        productId: transaction.productId,
        productCode,
        qty: transaction.qty,
      });
    } catch (error) {
      summary.errors.push({
        productId: productReport.productId,
        productCode: productReport.productCode,
        reason: error.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: "Negative stock opening transactions processed successfully",
    data: {
      distributorId,
      stockType,
      openingStockDate,
      summary,
      insertedTransactions,
    },
  });
});

module.exports = { fixNegativeStocks };
