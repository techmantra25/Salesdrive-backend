const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerMultiplierTransaction = require("../../models/retailerMultiplierTransaction.model");
const axios = require("axios");
const {
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
} = require("../../config/retailerApp.config");
const moment = require("moment-timezone");

const retryRetailerTransaction = asyncHandler(async (req, res) => {
  try {
    const { transactionId } = req.query;

    const transaction = await RetailerMultiplierTransaction.findById(
      transactionId
    );

    if (!transaction) {
      res.status(404);
      throw new Error("Transaction not found");
    }

    const status = transaction.status;

    if (status === "Success") {
      res.status(400);
      throw new Error("Transaction already successful");
    }

    const retailerId = transaction.retailerId;
    const point = transaction.point;
    const remark = transaction.remark;
    const transactionType = transaction.transactionType;

    if (transactionType === "credit") {
      const retailer = await OutletApproved.findById(retailerId);
      if (!retailer) {
        res.status(404);
        throw new Error("Retailer not found");
      }

      const body = {
        outlet_id: retailer.outletUID,
        amount: point,
        remarks: remark,
        type: "Sales Multiplier",
        entry_date: moment(transaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, body);
        if (earnPointsResponse.data?.error) {
          transaction.status = "Failed";
          transaction.apiResponse = earnPointsResponse.data;
        } else {
          transaction.status = "Success";
        }
      } catch (error) {
        transaction.status = "Failed";
        transaction.apiResponse = error?.response?.data || {
          message: "API call failed",
        };
      }
      await transaction.save();
    } else if (transactionType === "debit") {
      const retailer = await OutletApproved.findById(retailerId);
      if (!retailer) {
        res.status(404);
        throw new Error("Retailer not found");
      }

      const body = {
        outlet_id: retailer.outletUID,
        amount: point,
        remarks: remark,
        type: "Sales Multiplier",
        entry_date: moment(transaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const deductPointsResponse = await axios.post(
          RBP_POINT_DEBIT_API,
          body
        );
        if (deductPointsResponse.data?.error) {
          transaction.status = "Failed";
          transaction.apiResponse = deductPointsResponse.data;
        } else {
          transaction.status = "Success";
        }
      } catch (error) {
        transaction.status = "Failed";
        transaction.apiResponse = error?.response?.data || {
          message: "API call failed",
        };
      }
      await transaction.save();
    } else {
      res.status(400);
      throw new Error("Invalid transaction type");
    }

    res.status(200).json({
      error: false,
      message: "Transaction retried successfully",
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { retryRetailerTransaction };
