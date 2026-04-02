const asyncHandler = require("express-async-handler");
const { ObjectId } = require("mongodb");
const moment = require("moment-timezone");
const Transaction = require("../../models/transaction.model");
const StockLedger = require("../../models/stockLedger.model");
const Product = require("../../models/product.model");
const Distributor = require("../../models/distributor.model");

const fixStockLedger = asyncHandler(async (req, res) => {
  const { distributorCode, startDate } = req.body;

  // Validation
  if (!distributorCode || !startDate) {
    res.status(400);
    throw new Error("distributorCode and startDate are required");
  }

  const TIMEZONE = "Asia/Kolkata";
  const startOfDay = moment.tz(startDate, TIMEZONE).startOf("day").toDate();
  const endOfDay = moment.tz(new Date(), TIMEZONE).endOf("day").toDate();

  //find the distributor
  const distributor = await Distributor.findOne({ dbCode: distributorCode });

  if (!distributor) {
    res.status(404);
    throw new Error(`Distributor with code ${distributorCode} not found`);
  }

  const distributorId = distributor._id;

  // Products with transactions in date range
  const productsWithTransactions = await Transaction.distinct("productId", {
    distributorId: distributorId,
    date: { $gte: startOfDay, $lte: endOfDay },
  });

  // Products with ledger entries in date range can be orphan need to check
  const productsWithLedgers = await StockLedger.distinct("productId", {
    distributorId: distributorId,
    date: { $gte: startOfDay, $lte: endOfDay },
  });

  // Combine both sets - this catches everything including orphans
  const allAffectedProductIds = [
    ...new Set([
      ...productsWithTransactions.map((id) => id.toString()),
      ...productsWithLedgers.map((id) => id.toString()),
    ]),
  ];

  if (allAffectedProductIds.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No products found to fix in the specified date range",
      data: {
        distributorCode,
        distributorName: distributor.name,
        dateRange: { start: startOfDay, end: endOfDay },
        productsProcessed: 0,
        totalDeleted: 0,
        totalInserted: 0,
      },
    });
  }

  //   process each product
  let successCount = 0;
  let errorCount = 0;
  let totalDeleted = 0;
  let totalInserted = 0;
  let orphansDetected = 0;

  for (const productId of allAffectedProductIds) {
    try {
      const productObjectId = new ObjectId(productId);

      // Get the last good entry before startDate
      const lastGoodEntry = await StockLedger.findOne({
        distributorId: distributorId,
        productId: productObjectId,
        date: { $lt: startOfDay },
      })
        .sort({ date: -1 })
        .lean();

      const openingStock = lastGoodEntry?.closingStock || 0;
      const openingPoints = lastGoodEntry?.closingPoints || 0;

      // Get all transactions in the date range
      const transactions = await Transaction.find({
        distributorId: distributorId,
        productId: productObjectId,
        date: { $gte: startOfDay, $lte: endOfDay },
      })
        .sort({ date: 1, _id: 1 })
        .lean();

      // Check if this is an orphan
      const ledgerCount = await StockLedger.countDocuments({
        distributorId: distributorId,
        productId: productObjectId,
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      if (ledgerCount > 0 && transactions.length === 0) {
        orphansDetected++;
      }

      // Get product base points
      const product = await Product.findById(productId).lean();
      const basePoints = product?.base_point || 0;

      // Build corrected ledger entries
      const correctedEntries = [];
      let runningStock = openingStock;
      let runningPoints = openingPoints;

      for (const txn of transactions) {
        const currentOpening = runningStock;
        const currentOpeningPoints = runningPoints;

        const qtyChange = txn.type === "In" ? txn.qty : -txn.qty;
        const pointChange =
          txn.type === "In" ? txn.qty * basePoints : -(txn.qty * basePoints);

        const closingStock = currentOpening + qtyChange;
        const closingPoints = currentOpeningPoints + pointChange;

        correctedEntries.push({
          distributorId: distributorId,
          productId: productObjectId,
          transactionId: txn._id,
          date: txn.date,
          openingStock: currentOpening,
          openingPoints: currentOpeningPoints,
          transactionType: txn.transactionType,
          qtyChange,
          pointChange,
          closingStock,
          closingPoints,
        });

        runningStock = closingStock;
        runningPoints = closingPoints;
      }

      // Delete all existing ledger entries in the date range
      const deleteResult = await StockLedger.deleteMany({
        distributorId: distributorId,
        productId: productObjectId,
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      // Insert corrected entries
      if (correctedEntries.length > 0) {
        await StockLedger.insertMany(correctedEntries);
      }

      successCount++;
      totalDeleted += deleteResult.deletedCount;
      totalInserted += correctedEntries.length;
    } catch (error) {
      errorCount++;
      console.error(`Error fixing product ${productId}:`, error.message);
    }
  }

  res.status(200).json({
    success: true,
    message: "Stock ledger fix completed",
    data: {
      distributorCode,
      distributorName: distributor.name,
      dateRange: {
        start: startOfDay,
        end: endOfDay,
      },
      summary: {
        productsProcessed: allAffectedProductIds.length,
        productsWithTransactions: productsWithTransactions.length,
        productsWithLedgers: productsWithLedgers.length,
        orphansDetected,
        successfullyFixed: successCount,
        errors: errorCount,
        totalDeleted,
        totalInserted,
      },
    },
  });
});

module.exports = { fixStockLedger };