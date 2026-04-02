const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { retailerOutletTransactionCode } = require("../../utils/codeGenerator");

const Bill = require("../../models/bill.model");
const axios = require("axios");
const moment = require("moment-timezone");
const {
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
} = require("../../config/retailerApp.config");

const { retryNonSalesTransactions } = require("./retryNonSalesTransactions");

const cronRetryAllFailedRbpTransactions = asyncHandler(async (req, res) => {
  console.log("🚀 CRON Started → Distributor Wise Retry");

  const failedTxns = await DistributorTransaction.find({ status: "Failed" });

  if (!failedTxns.length) {
    return res.status(200).json({ message: "No failed transactions found" });
  }

  // Group by distributor
  const distributorGroups = {};
  failedTxns.forEach((txn) => {
    const distId = txn.distributorId.toString();
    if (!distributorGroups[distId]) distributorGroups[distId] = [];
    distributorGroups[distId].push(txn);
  });

  let summary = [];

  // Process distributor wise
  for (const distId in distributorGroups) {
    const distTxns = distributorGroups[distId];

    console.log(`\n📌 Processing Distributor → ${distId}`);

    const latestSuccessTxn = await DistributorTransaction.findOne({
      distributorId: distId,
      status: "Success",
    }).sort({ updatedAt: -1 });

    if (!latestSuccessTxn) {
      summary.push({
        distributorId: distId,
        message: "No success reference found for this distributor",
      });
      continue;
    }

    let referenceBalance = latestSuccessTxn.balance;

    let results = {
      distributorId: distId,
      total: distTxns.length,
      successful: 0,
      failed: 0,
      details: [],
      balanceUpdates: {
        initialBalance: referenceBalance,
        finalBalance: referenceBalance,
      },
    };

    const nonSalesTxnsList = [];

    for (let txn of distTxns) {
      if (
        txn.transactionFor !== "SALES" &&
        txn.transactionFor !== "Sales Return"
      ) {
        nonSalesTxnsList.push(txn);
        continue;
      }

      let retailerUID = null;
      if (txn.retailerId) {
        const retailer = await OutletApproved.findById(txn.retailerId);
        retailerUID = retailer?.outletUID || null;
      }

      if (!retailerUID) {
        results.failed++;
        continue;
      }

      // 🆕 Fetch DB Code
      let dbCode = "Unknown";
      const distributor = await Distributor.findById(txn.distributorId);
      if (distributor?.dbCode) dbCode = distributor.dbCode;

      // 🔥 Fetch Bill Number
      let billNo = "N/A";
      if (txn.billId) {
        const bill = await Bill.findById(txn.billId);
        if (bill) {
          billNo = bill.new_billno || bill.billNo || "N/A";
        }
      }

      // 🔥 Updated Remark
      let updatedRemark = txn.remark;
      if (txn.transactionFor === "SALES") {
        updatedRemark = `Reward points for Bill no ${billNo} for Retailer UID ${retailerUID} and DB Code ${dbCode}`;
      } else if (txn.transactionFor === "Sales Return") {
        updatedRemark = `Points deducted for Sales Return no ${txn.salesReturnNo} for Retailer UID ${retailerUID} and DB Code ${dbCode}`;
      }
      const body = {
        outlet_id: retailerUID,
        amount: txn.point,
        remarks: updatedRemark,
        entry_date: moment(txn.createdAt).format("YYYY-MM-DD"),
        type: txn.transactionFor,
      };

      try {
        // 🔍 Check if retailer transaction already exists (retry case)
        let retailerTxn = await RetailerOutletTransaction.findOne({
          distributorTransactionId: txn._id,
          billId: txn.billId,
          retailerId: txn.retailerId,
        });

        // 🔄 Get latest SUCCESS retailer balance
        const lastRetailerTxn = await RetailerOutletTransaction.findOne({
          retailerId: txn.retailerId,
          status: "Success",
        }).sort({ createdAt: -1 });

        const baseBalance = lastRetailerTxn?.balance || 0;

        // SALES = credit, Sales Return = debit
        const isCredit = txn.transactionFor === "SALES";
        const newBalance = isCredit
          ? baseBalance + txn.point
          : baseBalance - txn.point;

        if (retailerTxn) {
          // 🔁 RETRY → do NOT touch balance
          retailerTxn.transactionType = isCredit ? "credit" : "debit";
          retailerTxn.point = txn.point;
          retailerTxn.status = "Success";
          retailerTxn.remark = updatedRemark;
          retailerTxn.updatedAt = new Date();
          await retailerTxn.save();
        } else {
          // 🆕 FIRST TIME → apply balance
          const transactionId = await retailerOutletTransactionCode();

          const retailerTransactionData = {
            transactionId,
            retailerId: txn.retailerId,
            distributorId: txn.distributorId,
            distributorTransactionId: txn._id,
            billId: txn.billId,
            transactionType: isCredit ? "credit" : "debit",
            transactionFor: txn.transactionFor,
            point: txn.point,
            balance: newBalance,
            status: "Success",
            remark: updatedRemark,
          };

          // Copy backdate fields from distributor transaction if they exist
          if (txn.dates) {
            retailerTransactionData.dates = {
              deliveryDate: txn.dates.deliveryDate,
              originalDeliveryDate: txn.dates.originalDeliveryDate,
            };
            // Explicitly set timestamps for backdate
            if (txn.dates.deliveryDate) {
              retailerTransactionData.createdAt = txn.dates.deliveryDate;
              retailerTransactionData.updatedAt = txn.dates.deliveryDate;
            }
          }
          if (txn.enabledBackDate !== undefined) {
            retailerTransactionData.enabledBackDate = txn.enabledBackDate;
          }

          await RetailerOutletTransaction.create(retailerTransactionData);
        }

        // if (apiResponse?.error) {
        //   results.failed++;
        //   await DistributorTransaction.findByIdAndUpdate(txn._id, {
        //     status: "Failed",
        //     apiResponse,
        //   });
        //   continue;
        // }

        const distributorBalanceChange =
          txn.transactionFor === "SALES"
            ? -txn.point // SALES → distributor debit
            : txn.point; // Sales Return → distributor credit

        referenceBalance += distributorBalanceChange;

        await DistributorTransaction.findByIdAndUpdate(txn._id, {
          $set: {
            status: "Success",
            balance: referenceBalance,
            remark: updatedRemark,
            apiResponse: null,
            updatedAt: new Date(),
          },
        });

        results.successful++;
      } catch {
        results.failed++;
      }
    }

    if (nonSalesTxnsList.length > 0) {
      referenceBalance = await retryNonSalesTransactions(
        nonSalesTxnsList,
        referenceBalance,
        results,
      );
    }

    results.balanceUpdates.finalBalance = referenceBalance;
    summary.push(results);
  }

  console.log("🎯 All Distributors Processed Successfully");
  return res.status(200).json({ summary });
});

module.exports = { cronRetryAllFailedRbpTransactions };
