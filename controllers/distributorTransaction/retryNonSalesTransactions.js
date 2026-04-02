const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const retryNonSalesTransactions = asyncHandler(async (failedTransactions, referenceBalance, results) => {
  for (let txn of failedTransactions) {
    const result = {
      transactionId: txn._id,
      transactionFor: txn.transactionFor,
      transactionType: txn.transactionType,
      point: txn.point,
      status: "Failed",
      error: null,
      balanceImpact: 0,
      oldBalance: referenceBalance,
      newBalance: null,
      oldUpdatedAt: txn.updatedAt,
      newUpdatedAt: null,
    };

    try {

      // Update Balance Manually
      if (txn.transactionType === "credit") {
        referenceBalance += txn.point;
        results.balanceUpdates.totalCredits += txn.point;
      } else {
        referenceBalance -= txn.point;
        results.balanceUpdates.totalDebits += txn.point;
      }

      result.newBalance = referenceBalance;
      result.balanceImpact = txn.transactionType === "credit" ? txn.point : -txn.point;

      const currentTimestamp = new Date();

      await DistributorTransaction.updateOne(
        { _id: txn._id },
        {
          $set: {
            status: "Success",
            balance: referenceBalance,
            apiResponse: null,
            updatedAt: currentTimestamp,
          },
        }
      );

      result.status = "Success";
      result.newUpdatedAt = currentTimestamp;
      results.successful++;
    } catch (err) {
      result.error = err.message;
      results.failed++;
    }

    results.details.push(result);
  }

  return referenceBalance;
});

module.exports = { retryNonSalesTransactions };
