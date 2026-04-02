const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");

/**
 * Rebuild retailer outlet balance trail
 * createdAt is NOT modified
 */
exports.rebuildRetailerOutletBalance = asyncHandler(async (req, res) => {

  const { retailerId } = req.params;
    console.log("Rebuilding retailer outlet balance", retailerId );

  if (!mongoose.Types.ObjectId.isValid(retailerId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid retailerId",
    });
  }

  // 1️⃣ Fetch all successful transactions in chronological order
  const transactions = await RetailerOutletTransaction.find({
    retailerId,
    status: "Success",
  }).sort({ createdAt: 1, _id: 1 });

  console.log(
    `📊 Found ${transactions.length} transactions for retailer ${retailerId}`,
  );

  // if (!transactions.length) {
  //   return res.status(200).json({
  //     success: true,
  //     message: "No transactions found to rebuild",
  //     retailerId,
  //   });
  // }

  let runningBalance = 0;
  let updatedCount = 0;

  // 2️⃣ Recalculate balance sequentially
  for (const txn of transactions) {
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

    updatedCount++;
  }

  await OutletApproved.updateOne(
    { _id: retailerId },
    { $set: { currentPointBalance: runningBalance } },
    { timestamps: false },
  );

  console.log(`💰 Final balance for retailer ${retailerId}: ${runningBalance}`);

  return res.status(200).json({
    success: true,
    message:
      transactions.length > 0
        ? "Retailer outlet balance rebuilt successfully"
        : "No transactions found - balance set to 0",
    retailerId,
    totalTransactions: transactions.length,
    updatedCount,
    finalBalance: runningBalance,
  });
});
