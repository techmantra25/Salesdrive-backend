const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");

/**
 * Rebuild balance trail ONLY for ACTIVE retailers
 * that exist in RetailerOutletTransaction
 */
exports.rebuildRetailerOutletBalanceFromTransactions = asyncHandler(
  async (req, res) => {
    console.log("🔥 Starting bulk retailer balance rebuild...");

    // 1️⃣ Get DISTINCT retailerIds from successful transactions
    const retailerIdsCursor = RetailerOutletTransaction.aggregate([
      {
        $match: {
          status: "Success",
          retailerId: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$retailerId",
        },
      },
    ]).cursor({ batchSize: 500 });

    let processedRetailers = 0;
    let totalTxnsUpdated = 0;
    const processedRetailerIds = [];

    // 2️⃣ Iterate retailerIds from transactions
    for await (const doc of retailerIdsCursor) {
      const retailerId = doc._id;

      // 3️⃣ Ensure retailer is ACTIVE
      const retailerExists = await OutletApproved.exists({
        _id: retailerId,
        // status: true,
      });

      if (!retailerExists) continue;

      // 4️⃣ Fetch transactions in correct order
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

        // Update only balance (createdAt untouched)
        await RetailerOutletTransaction.updateOne(
          { _id: txn._id },
          { $set: { balance: runningBalance } },
          { timestamps: false },
        );

        totalTxnsUpdated++;
      }

      // 5️⃣ Update master balance
      await OutletApproved.updateOne(
        { _id: retailerId },
        { $set: { currentPointBalance: runningBalance } },
        { timestamps: false },
      );

      processedRetailers++;
      processedRetailerIds.push(retailerId);

      if (processedRetailers % 100 === 0) {
        console.log(
          `✔ Processed ${processedRetailers} retailers | Updated ${totalTxnsUpdated} transactions`,
        );
      }
    }
    console.log("🔍 Checking for retailers without transactions...");

    const unprocessedRetailers = await OutletApproved.find({
      status: true,
      _id: { $nin: processedRetailerIds },
    })
      .select("_id")
      .lean();

    let resetCount = 0;

    // Reset their balance to 0
    for (const retailer of unprocessedRetailers) {
      await OutletApproved.updateOne(
        { _id: retailer._id },
        { $set: { currentPointBalance: 0 } },
        { timestamps: false },
      );
      resetCount++;
      processedRetailers++;
    }

    console.log(
      `✅ Reset ${resetCount} retailers without transactions to balance 0`,
    );

    return res.status(200).json({
      success: true,
      message: "Retailer balance rebuild completed (transaction-based)",
      processedRetailers,
      totalTxnsUpdated,
      retailersWithTransactions: processedRetailerIds.length,
      retailersResetToZero: resetCount,
    });
  },
);
