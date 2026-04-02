const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Distributor = require("../../models/distributor.model");
const Bill = require("../../models/bill.model")
const OutletApproved = require("../../models/outletApproved.model");
const axios = require("axios");
const moment = require("moment-timezone");

const {
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
} = require("../../config/retailerApp.config");

const { retrySingleNonSalesTransaction } = require("./retrySingleNonSalesTransaction");

const retrySingleSalesTransaction = asyncHandler(async (req, res) => {
  try {
    const { transactionId } = req.query;
    console.log("📩 ID:", transactionId);

    if (!transactionId) {
      return res.status(400).json({ message: "Transaction ID is required" });
    }

    const txn = await DistributorTransaction.findById(transactionId)
      .populate("retailerId");

    if (!txn) return res.status(404).json({ message: "Transaction not found" });

    if (txn.status === "Success") {
      return res.status(200).json({
        message: "Transaction already successful",
        result: [],
      });
    }

    // ⛔ Non-Sales handled separately
    if (txn.transactionFor !== "SALES" &&
      txn.transactionFor !== "Sales Return") {

      const response = await retrySingleNonSalesTransaction(txn);
      return res.status(200).json({
        message: "Non-Sales retry completed",
        result: response.result,
        finalBalance: response.updatedBalance,
      });
    }

    // 🔔 Get retailer UID
    const retailerUID = txn.retailerId?.outletUID;
    if (!retailerUID) {
      return res.status(400).json({ message: "Retailer UID not found" });
    }

    // 🔹 Get latest success reference balance
    const latestSuccessTxn = await DistributorTransaction.findOne({
      distributorId: txn.distributorId,
      status: "Success",
    }).sort({ updatedAt: -1 });

    if (!latestSuccessTxn) {
      return res.status(400).json({
        message: "No successful transaction found to calculate balance",
      });
    }

    const referenceBalance = latestSuccessTxn.balance;

    // 🆕 NEW REMARK (always reset for SALES / Sales Return)
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
    // API Request body
    const body = {
      outlet_id: retailerUID,
      amount: txn.point,
      remarks: updatedRemark,
      entry_date: moment(txn.createdAt).format("YYYY-MM-DD"),
      type: txn.transactionFor,
    };

    // Call API
    let apiResponse =
      txn.transactionType === "credit"
        ? await axios.post(RBP_POINT_DEBIT_API, body)
        : await axios.post(RBP_POINT_CREDIT_API, body);

    if (apiResponse?.data?.error) {
      await DistributorTransaction.findByIdAndUpdate(txn._id, {
        status: "Failed",
        apiResponse: apiResponse.data,
      });
      return res.status(400).json({
        message: "External API Failed",
        error: apiResponse.data,
      });
    }

    // 🔥 Balance update – SAME AS BULK
    const change = txn.transactionType === "credit" ? txn.point : -txn.point;
    const newBalance = referenceBalance + change;

    const updatedTxn = await DistributorTransaction.findByIdAndUpdate(
      txn._id,
      {
        $set: {
          status: "Success",
          balance: newBalance,
          remark: updatedRemark,       // ⬅ save new remark
          apiResponse: null,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    console.log(`✔ Sales Updated → Ref: ${referenceBalance} | New: ${newBalance}`);

    return res.status(200).json({
      message: "Sales retry completed",
      result: {
        transactionId: updatedTxn._id,
        oldBalance: referenceBalance,
        newBalance,
        balanceImpact: change,
        oldUpdatedAt: txn.updatedAt,
        newUpdatedAt: updatedTxn.updatedAt,
      },
    });

  } catch (err) {
    console.error("❌ Retry Error:", err.message);
    return res.status(400).json({ message: err.message });
  }
});

module.exports = { retrySingleSalesTransaction };
