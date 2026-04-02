const asyncHandler = require("express-async-handler");
const { ObjectId } = require("mongodb");
const moment = require("moment-timezone");
const Transaction = require("../../models/transaction.model");
const StockLedger = require("../../models/stockLedger.model");
const Product = require("../../models/product.model");
const Distributor = require("../../models/distributor.model");

const TIMEZONE = "Asia/Kolkata";

const getDateRangeFromLastMonthTillToday = () => {
  const now = moment.tz(TIMEZONE);
  return {
    startOfRange: now.clone().subtract(1, "month").startOf("month").toDate(),
    endOfRange: now.clone().endOf("day").toDate(),
  };
};

const fixStockLedgerForDistributor = async ({
  distributorId,
  distributorCode,
  distributorName,
  startOfRange,
  endOfRange,
}) => {
  const productsWithTransactions = await Transaction.distinct("productId", {
    distributorId,
    date: { $gte: startOfRange, $lte: endOfRange },
  });

  const productsWithLedgers = await StockLedger.distinct("productId", {
    distributorId,
    date: { $gte: startOfRange, $lte: endOfRange },
  });

  const allAffectedProductIds = [
    ...new Set([
      ...productsWithTransactions.map((id) => id.toString()),
      ...productsWithLedgers.map((id) => id.toString()),
    ]),
  ];

  if (!allAffectedProductIds.length) {
    return {
      distributorId: distributorId.toString(),
      distributorCode,
      distributorName,
      productsProcessed: 0,
      productsWithTransactions: 0,
      productsWithLedgers: 0,
      orphansDetected: 0,
      successfullyFixed: 0,
      errors: 0,
      totalDeleted: 0,
      totalInserted: 0,
    };
  }

  const productObjectIds = allAffectedProductIds.map((id) => new ObjectId(id));
  const products = await Product.find(
    { _id: { $in: productObjectIds } },
    { base_point: 1 },
  ).lean();

  const basePointMap = new Map(
    products.map((product) => [
      product._id.toString(),
      product.base_point || 0,
    ]),
  );

  let successCount = 0;
  let errorCount = 0;
  let totalDeleted = 0;
  let totalInserted = 0;
  let orphansDetected = 0;

  for (const productId of allAffectedProductIds) {
    try {
      const productObjectId = new ObjectId(productId);

      const lastGoodEntry = await StockLedger.findOne({
        distributorId,
        productId: productObjectId,
        date: { $lt: startOfRange },
      })
        .sort({ date: -1 })
        .lean();

      const openingStock = lastGoodEntry?.closingStock || 0;
      const openingPoints = lastGoodEntry?.closingPoints || 0;

      const transactions = await Transaction.find({
        distributorId,
        productId: productObjectId,
        date: { $gte: startOfRange, $lte: endOfRange },
      })
        .sort({ date: 1, _id: 1 })
        .lean();

      const ledgerCount = await StockLedger.countDocuments({
        distributorId,
        productId: productObjectId,
        date: { $gte: startOfRange, $lte: endOfRange },
      });

      if (ledgerCount > 0 && transactions.length === 0) {
        orphansDetected++;
      }

      const basePoints = basePointMap.get(productId) || 0;
      const correctedEntries = [];

      let runningStock = openingStock;
      let runningPoints = openingPoints;

      for (const txn of transactions) {
        const currentOpening = runningStock;
        const currentOpeningPoints = runningPoints;

        const qty = Number(txn.qty || 0);
        const qtyChange = txn.type === "In" ? qty : -qty;
        const pointChange =
          txn.type === "In" ? qty * basePoints : -(qty * basePoints);

        const closingStock = currentOpening + qtyChange;
        const closingPoints = currentOpeningPoints + pointChange;

        correctedEntries.push({
          distributorId,
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

      const deleteResult = await StockLedger.deleteMany({
        distributorId,
        productId: productObjectId,
        date: { $gte: startOfRange, $lte: endOfRange },
      });

      if (correctedEntries.length) {
        await StockLedger.insertMany(correctedEntries);
      }

      successCount++;
      totalDeleted += deleteResult.deletedCount;
      totalInserted += correctedEntries.length;
    } catch (error) {
      errorCount++;
      console.error(
        `Error fixing stock ledger for distributor ${distributorCode || distributorId} and product ${productId}:`,
        error.message,
      );
    }
  }

  return {
    distributorId: distributorId.toString(),
    distributorCode,
    distributorName,
    productsProcessed: allAffectedProductIds.length,
    productsWithTransactions: productsWithTransactions.length,
    productsWithLedgers: productsWithLedgers.length,
    orphansDetected,
    successfullyFixed: successCount,
    errors: errorCount,
    totalDeleted,
    totalInserted,
  };
};

const fixStockLedgerAllDistributors = asyncHandler(async (req, res) => {
  const { startDate } = req.body || {};

  const computedDateRange = startDate
    ? {
        startOfRange: moment.tz(startDate, TIMEZONE).startOf("day").toDate(),
        endOfRange: moment.tz(TIMEZONE).endOf("day").toDate(),
      }
    : getDateRangeFromLastMonthTillToday();

  const { startOfRange, endOfRange } = computedDateRange;

  const distributors = await Distributor.find(
    { dbCode: { $exists: true, $ne: null } },
    { _id: 1, dbCode: 1, name: 1 },
  )
    .sort({ _id: 1 })
    .lean();

  if (!distributors.length) {
    return res.status(200).json({
      success: true,
      message: "No distributors found to process",
      data: {
        dateRange: {
          start: startOfRange,
          end: endOfRange,
        },
        summary: {
          distributorsFound: 0,
          distributorsProcessed: 0,
          distributorsWithChanges: 0,
          distributorErrors: 0,
          productsProcessed: 0,
          totalDeleted: 0,
          totalInserted: 0,
          totalProductErrors: 0,
          orphansDetected: 0,
        },
      },
    });
  }

  const overall = {
    distributorsFound: distributors.length,
    distributorsProcessed: 0,
    distributorsWithChanges: 0,
    distributorErrors: 0,
    productsProcessed: 0,
    totalDeleted: 0,
    totalInserted: 0,
    totalProductErrors: 0,
    orphansDetected: 0,
  };

  const distributorResults = [];

  for (const distributor of distributors) {
    try {
      const distributorResult = await fixStockLedgerForDistributor({
        distributorId: distributor._id,
        distributorCode: distributor.dbCode,
        distributorName: distributor.name,
        startOfRange,
        endOfRange,
      });

      overall.distributorsProcessed++;
      overall.productsProcessed += distributorResult.productsProcessed;
      overall.totalDeleted += distributorResult.totalDeleted;
      overall.totalInserted += distributorResult.totalInserted;
      overall.totalProductErrors += distributorResult.errors;
      overall.orphansDetected += distributorResult.orphansDetected;

      if (distributorResult.productsProcessed > 0) {
        overall.distributorsWithChanges++;
      }

      distributorResults.push(distributorResult);
    } catch (error) {
      overall.distributorErrors++;
      distributorResults.push({
        distributorId: distributor._id.toString(),
        distributorCode: distributor.dbCode,
        distributorName: distributor.name,
        error: error.message,
      });

      console.error(
        `Critical error fixing stock ledger for distributor ${distributor.dbCode || distributor._id}:`,
        error.message,
      );
    }
  }

  return res.status(200).json({
    success: true,
    message: "Stock ledger fix completed for all distributors",
    triggeredBy: req.user?.email || req.user?._id || "manual",
    data: {
      dateRange: {
        start: startOfRange,
        end: endOfRange,
      },
      summary: overall,
      distributors: distributorResults,
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = { fixStockLedgerAllDistributors };
