const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const rebuildDistributorTransactions = async (distributorId) => {
  const transactions = await DistributorTransaction.find({
    distributorId,
    status: "Success",
  }).sort({ createdAt: 1, _id: 1 });

  let runningBalance = 0;
  let updatedCount = 0;

  for (const txn of transactions) {
    if (txn.transactionType === "credit") {
      runningBalance += txn.point;
    } else if (txn.transactionType === "debit") {
      runningBalance -= txn.point;
    }

    await DistributorTransaction.updateOne(
      { _id: txn._id },
      { $set: { balance: runningBalance } },
      { timestamps: false },
    );

    updatedCount++;
  }

  return {
    totalTransactions: transactions.length,
    updatedCount,
    finalBalance: runningBalance,
  };
};

/**
 * Rebuild distributor balance trail
 * createdAt is NOT modified
 */
exports.rebuildDistributorBalance = asyncHandler(async (req, res) => {
  const { distributorId } = req.params;
  console.log("Rebuilding distributor balance...", distributorId);

  if (!mongoose.Types.ObjectId.isValid(distributorId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid distributorId",
    });
  }

  const rebuildResult = await rebuildDistributorTransactions(distributorId);

  return res.status(200).json({
    success: true,
    message: "Distributor balance rebuilt successfully",
    distributorId,
    totalTransactions: rebuildResult.totalTransactions,
    updatedCount: rebuildResult.updatedCount,
    finalBalance: rebuildResult.finalBalance,
  });
});

exports.rebuildAllDistributorBalances = asyncHandler(async (req, res) => {
  console.log("🔥 Starting distributor balance rebuild trigger...");

  try {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59,
    );

    const stats = {
      processed: 0,
      txnsUpdated: 0,
      errors: [],
    };

    const distributorIdsCursor = DistributorTransaction.aggregate([
      {
        $match: {
          status: "Success",
          createdAt: { $gte: startDate, $lte: endDate },
          distributorId: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$distributorId",
        },
      },
    ]).cursor({ batchSize: 500 });

    for await (const doc of distributorIdsCursor) {
      const distributorId = doc._id;

      try {
        const rebuildResult =
          await rebuildDistributorTransactions(distributorId);

        if (!rebuildResult.totalTransactions) {
          continue;
        }

        stats.processed++;
        stats.txnsUpdated += rebuildResult.updatedCount;

        if (stats.processed % 50 === 0) {
          console.log(
            `✔ Distributor Progress: ${stats.processed} distributors | ${stats.txnsUpdated} transactions updated`,
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing distributor ${distributorId}:`,
          error.message,
        );
        stats.errors.push({
          distributorId: distributorId.toString(),
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Distributor balance rebuild completed",
      triggeredBy: req.user?.email || req.user?._id || "manual",
      dateRange: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      },
      distributors: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "🔥 Critical error during distributor balance rebuild:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Distributor balance rebuild failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
