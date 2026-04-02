const DistributorTransaction = require("../../models/distributorTransaction.model");

const retrySingleNonSalesTransaction = async (txn) => {
  console.log("🔹 Non-Sales retry started for:", txn._id);

  // ✅ Get latest successful transaction for this distributor
  const latestSuccessTxn = await DistributorTransaction.findOne({
    distributorId: txn.distributorId,
    status: "Success",
  }).sort({ updatedAt: -1 });

  if (!latestSuccessTxn) {
    throw new Error("No successful transaction found to calculate balance");
  }

  const referenceBalance = latestSuccessTxn.balance;
  const change = txn.transactionType === "credit" ? txn.point : -txn.point;
  const newBalance = referenceBalance + change;

  // ⏫ Update ONLY this transaction
  const updatedTxn = await DistributorTransaction.findByIdAndUpdate(
    txn._id,
    {
      $set: {
        status: "Success",
        balance: newBalance,
        apiResponse: null,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );

  console.log(`✔ Non-Sales Updated → Ref: ${referenceBalance} | New: ${newBalance}`);

  return {
    result: {
      transactionId: updatedTxn._id,
      transactionFor: updatedTxn.transactionFor,
      transactionType: updatedTxn.transactionType,
      point: updatedTxn.point,
      status: "Success",
      oldBalance: referenceBalance,
      newBalance,
      balanceImpact: change,
      oldUpdatedAt: txn.updatedAt,
      newUpdatedAt: updatedTxn.updatedAt,
    },
    updatedBalance: newBalance,
  };
};

module.exports = { retrySingleNonSalesTransaction };
