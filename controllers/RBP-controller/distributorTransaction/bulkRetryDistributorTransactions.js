const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const Distributor = require("../../../models/distributor.model");
const Bill = require("../../../models/bill.model");
const OutletApproved = require("../../../models/outletApproved.model");
const axios = require("axios");
const moment = require("moment-timezone");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const {
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
} = require("../../../config/retailerApp.config");

const {
  retryNonSalesTransactions,
} = require("../../../controllers/distributorTransaction/retryNonSalesTransactions");

/**
 * BULK RETRY FAILED TRANSACTIONS FOR SALES / SALES RETURN
 */
const bulkRetryDistributorTransactions = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.query;

    if (!distributorId) {
      res.status(400);
      throw new Error("Distributor ID is required");
    }

    const latestSuccessTxn = await DistributorTransaction.findOne({
      distributorId,
      status: "Success",
    })
      .sort({ updatedAt: -1 })
      .limit(1);

    if (!latestSuccessTxn) {
      return res.status(400).json({
        message: "No successful transaction found to calculate balance",
      });
    }

    const failedTxns = await DistributorTransaction.find({
      distributorId,
      status: "Failed",
    }).populate("retailerId");

    if (!failedTxns.length) {
      return res.status(200).json({
        message: "No failed transactions found for this distributor",
        results: { total: 0, successful: 0, failed: 0, details: [] },
      });
    }

    const results = {
      total: failedTxns.length,
      successful: 0,
      failed: 0,
      details: [],
      balanceUpdates: {
        initialBalance: latestSuccessTxn.balance,
        finalBalance: latestSuccessTxn.balance,
        totalCredits: 0,
        totalDebits: 0,
      },
    };

    let referenceBalance = latestSuccessTxn.balance;

    const nonSalesTxnsList = [];

    for (let txn of failedTxns) {
      if (
        txn.transactionFor !== "SALES" &&
        txn.transactionFor !== "Sales Return"
      ) {
        nonSalesTxnsList.push(txn);
        continue;
      }

      let result = {
        transactionId: txn._id,
        transactionFor: txn.transactionFor,
        transactionType: txn.transactionType,
        point: txn.point,
        status: "Failed",
        error: null,
        oldBalance: referenceBalance,
        newBalance: null,
        oldUpdatedAt: txn.updatedAt,
        newUpdatedAt: null,
      };

      try {
        let retailerUID = null;

        if (txn.retailerId && txn.retailerId._id) {
          const retailer = await OutletApproved.findById(txn.retailerId._id);
          if (retailer) retailerUID = retailer.outletUID;
        }

        if (!retailerUID) {
          result.error = "Retailer UID not available for API";
          results.failed++;
          results.details.push(result);
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
          if (bill?.billNo) billNo = bill.billNo;
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

        let apiSuccess = false;
        let apiResponse = null;
        if (
          txn.transactionFor === "SALES" ||
          txn.transactionFor === "Sales Return"
        ) {
          // 🔍 Check existing retailer transaction
          // 🔍 Check existing retailer transaction
          console.log("txn.retailerId._id,", txn.retailerId._id);
          let retailerTxn = await RetailerOutletTransaction.findOne({
            distributorTransactionId: txn._id,
            billId: txn.billId,
            retailerId: txn.retailerId._id,
          });
          console.log("Retailetxn", retailerTxn);
          // 🔄 Get latest SUCCESS balance
          const lastRetailerTxn = await RetailerOutletTransaction.findOne({
            retailerId: txn.retailerId._id,
            status: "Success",
          }).sort({ createdAt: -1 }); // ✅ CORRECT

          console.log("Latest tRANSECTION", lastRetailerTxn);

          const baseBalance = lastRetailerTxn?.balance || 0;
          console.log("Latest Balance", baseBalance);

          // ✅ Retailer logic is DIRECT
          const isCredit = txn.transactionFor === "SALES";

          const newBalance = isCredit
            ? baseBalance + txn.point
            : baseBalance - txn.point;

          if (retailerTxn) {
            // 🔁 RETRY CASE → DO NOT TOUCH BALANCE
            retailerTxn.transactionType = isCredit ? "credit" : "debit";
            retailerTxn.point = txn.point;
            retailerTxn.status = "Success";
            retailerTxn.remark = updatedRemark;
            retailerTxn.updatedAt = new Date();

            await retailerTxn.save();
          } else {
            // 🆕 FIRST TIME → APPLY BALANCE
            const transactionId = await retailerOutletTransactionCode();

            const retailerTransactionData = {
              transactionId,
              retailerId: txn.retailerId._id,
              distributorId: txn.distributorId,
              distributorTransactionId: txn._id,
              billId: txn.billId,
              transactionType: isCredit ? "credit" : "debit",
              transactionFor: txn.transactionFor,
              point: txn.point,
              balance: newBalance, // ✅ ONLY HERE
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

            retailerTxn = await RetailerOutletTransaction.create(
              retailerTransactionData,
            );
          }

          apiResponse = { retailerTransactionId: retailerTxn._id };
          apiSuccess = true;
        }

        if (!apiSuccess) {
          txn.status = "Failed";
          txn.apiResponse = apiResponse;
          await txn.save();
          result.error = apiResponse;
          results.failed++;
          results.details.push(result);
          continue;
        }

        let balanceChange =
          txn.transactionType === "credit" ? txn.point : -txn.point;
        referenceBalance += balanceChange;

        const currTime = new Date();

        await DistributorTransaction.updateOne(
          { _id: txn._id },
          {
            $set: {
              status: "Success",
              balance: referenceBalance,
              remark: updatedRemark, // 🆕 SAVE remark change
              apiResponse: null,
              updatedAt: currTime,
            },
          },
        );

        result.newUpdatedAt = currTime;
        result.newBalance = referenceBalance;
        result.status = "Success";
        result.balanceImpact = balanceChange;

        if (txn.transactionType === "credit")
          results.balanceUpdates.totalCredits += txn.point;
        else results.balanceUpdates.totalDebits += txn.point;

        results.successful++;
        results.details.push(result);
      } catch (err) {
        result.error = err.message;
        results.details.push(result);
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

    return res.status(200).json({
      message: "Bulk retry completed",
      results,
    });
  } catch (err) {
    res.status(400);
    throw new Error(err.message || "Something went wrong");
  }
});

module.exports = { bulkRetryDistributorTransactions };
