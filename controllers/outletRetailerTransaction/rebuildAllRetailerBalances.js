const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");

/**
 * Rebuild retailer balance for all active retailers
 * that had successful transactions from last month to today.
 * Updates running balance on each transaction and master currentPointBalance.
 * Triggered manually via admin button.
 */
exports.rebuildAllRetailerBalances = asyncHandler(async (req, res) => {
  console.log("🔥 Starting retailer balance rebuild trigger...");

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

    const retailerIdsCursor = RetailerOutletTransaction.aggregate([
      {
        $match: {
          status: "Success",
          createdAt: { $gte: startDate, $lte: endDate },
          retailerId: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$retailerId",
        },
      },
    ]).cursor({ batchSize: 500 });

    for await (const doc of retailerIdsCursor) {
      const retailerId = doc._id;

      try {
        const retailerExists = await OutletApproved.exists({
          _id: retailerId,
          status: true,
        });

        if (!retailerExists) continue;

        const txns = await RetailerOutletTransaction.find({
          retailerId,
          status: "Success",
        }).sort({ createdAt: 1, _id: 1 });

        if (!txns.length) continue;

        let runningBalance = 0;

        for (const txn of txns) {
          if (txn.transactionType === "credit") {
            runningBalance += txn.point;
          } else if (txn.transactionType === "debit") {
            runningBalance -= txn.point;
          }

          await RetailerOutletTransaction.updateOne(
            { _id: txn._id },
            { $set: { balance: runningBalance } },
            { timestamps: false },
          );

          stats.txnsUpdated++;
        }

        await OutletApproved.updateOne(
          { _id: retailerId },
          { $set: { currentPointBalance: runningBalance } },
          { timestamps: false },
        );

        stats.processed++;

        if (stats.processed % 100 === 0) {
          console.log(
            `✔ Retailer Progress: ${stats.processed} retailers | ${stats.txnsUpdated} transactions updated`,
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing retailer ${retailerId}:`,
          error.message,
        );
        stats.errors.push({
          retailerId: retailerId.toString(),
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Retailer balance rebuild completed",
      triggeredBy: req.user?.email || req.user?._id || "manual",
      dateRange: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      },
      retailers: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("🔥 Critical error during retailer balance rebuild:", error);

    return res.status(500).json({
      success: false,
      message: "Retailer balance rebuild failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
