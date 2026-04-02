const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const BATCH_SIZE = 50;

const bulkSyncRetailerOutletTransactions = asyncHandler(async (req, res) => {
  try {
    console.log("🚀 Bulk retailer outlet sync started");

    const distributorTxns = await DistributorTransaction.find({
      status: "Success",
      transactionFor: { $in: ["SALES", "Sales Return"] },
      retailerOutletTransactionId: { $exists: false },
      retailerId: { $ne: null },
    }).sort({ createdAt: 1 });

    if (!distributorTxns.length) {
      return res.status(200).json({
        status: 200,
        message: "No distributor transactions pending for sync",
        report: [],
      });
    }

    let createdCount = 0;
    const retailerBalanceMap = new Map();
    const report = [];

    for (let i = 0; i < distributorTxns.length; i += BATCH_SIZE) {
      const batch = distributorTxns.slice(i, i + BATCH_SIZE);
      const batchNo = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`🟡 Processing batch ${batchNo}`);

      for (const txn of batch) {
        const reportItem = {
          distributorTransactionId: txn._id,
          distributorTransactionCode: txn.transactionId,
          retailerId: txn.retailerId,
          transactionFor: txn.transactionFor,
          points: txn.point,
          status: "SKIPPED",
          remark: "",
        };

        try {
          const retailer = await OutletApproved.findById(txn.retailerId).lean();
          if (!retailer?.outletUID) {
            reportItem.remark = "Retailer UID missing";
            report.push(reportItem);
            continue;
          }

          let currentBalance;
          if (retailerBalanceMap.has(txn.retailerId.toString())) {
            currentBalance = retailerBalanceMap.get(txn.retailerId.toString());
          } else {
            const lastTxn = await RetailerOutletTransaction.findOne({
              retailerId: txn.retailerId,
            }).sort({ createdAt: -1 });

            currentBalance = lastTxn
              ? Number(lastTxn.balance)
              : Number(retailer.currentPointBalance) || 0;
          }

          const transactionType =
            txn.transactionType === "credit" ? "debit" : "credit";

          const newBalance =
            transactionType === "credit"
              ? currentBalance + Number(txn.point)
              : currentBalance - Number(txn.point);

          if (newBalance < 0) {
            reportItem.remark = "Negative balance detected";
            reportItem.oldBalance = currentBalance;
            reportItem.newBalance = newBalance;
            report.push(reportItem);
            continue;
          }

          const rtoCode = await retailerOutletTransactionCode("RTO");

          const retailerTxn = new RetailerOutletTransaction({
            retailerId: txn.retailerId,
            distributorTransactionId: txn._id,
            transactionId: rtoCode,
            transactionType,
            transactionFor: txn.transactionFor,
            point: Number(txn.point),
            balance: Number(newBalance),
            billId: txn.billId,
            salesReturnId: txn.salesReturnId,
            distributorId: txn.distributorId,
            status: "Success",
            remark: txn.remark,
            createdAt: txn.createdAt,
            updatedAt: txn.updatedAt,
          });

          retailerTxn.$timestamps(false);
          await retailerTxn.save();

          txn.retailerOutletTransactionId = retailerTxn._id;
          await txn.save({ timestamps: false });

          retailerBalanceMap.set(txn.retailerId.toString(), newBalance);

          createdCount++;

          reportItem.status = "SYNCED";
          reportItem.transactionType = transactionType;
          reportItem.oldBalance = currentBalance;
          reportItem.newBalance = newBalance;
          reportItem.retailerOutletTransactionId = retailerTxn._id;
          reportItem.retailerOutletTransactionCode = rtoCode;
          reportItem.remark = "Synced successfully";

          report.push(reportItem);

          console.log(`✅ Synced ${txn._id} → ${rtoCode}`);
        } catch (err) {
          reportItem.status = "FAILED";
          reportItem.remark = err.message;
          report.push(reportItem);

          console.error(`🔥 Error syncing txn ${txn._id}:`, err.message);
        }
      }
    }

    // Update retailer current balances
    console.log("🔄 Updating retailer balances...");
    for (const [retailerId, balance] of retailerBalanceMap) {
      await OutletApproved.findByIdAndUpdate(
        retailerId,
        { $set: { currentPointBalance: balance } },
        { timestamps: false },
      );
    }

    console.log(`✅ Updated balances for ${retailerBalanceMap.size} retailers`);

    console.log("🏁 Bulk sync completed");

    return res.status(200).json({
      status: 200,
      message: "Bulk retailer outlet transactions sync completed",
      totalFound: distributorTxns.length,
      totalSynced: createdCount,
      batchSize: BATCH_SIZE,
      report, // ✅ FINAL JSON REPORT
    });
  } catch (error) {
    console.error("🔥 Bulk sync fatal error:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = bulkSyncRetailerOutletTransactions;
