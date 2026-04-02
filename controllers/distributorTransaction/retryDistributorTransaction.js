const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const axios = require("axios");
const moment = require("moment-timezone");
const {
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
} = require("../../config/retailerApp.config");

const retryDistributorTransaction = asyncHandler(async (req, res) => {
  try {
    const { transactionId } = req.query;

    if (!transactionId) {
      res.status(400);
      throw new Error("Transaction ID is required");
    }
    DistributorTransaction;
    const transaction = await DistributorTransaction.findById(transactionId);

    if (!transaction) {
      res.status(404);
      throw new Error("Transaction not found");
    }

    const transactionFor = transaction.transactionFor;
    const status = transaction.status;

    if (status === "Success") {
      res.status(400);
      throw new Error("Transaction already successful");
    }

    if (transactionFor === "SALES") {
      const retailerId = transaction.retailerId;
      const point = transaction.point;
      const remark = transaction.remark;

      const retailer = await OutletApproved.findById(retailerId);
      if (!retailer) {
        res.status(404);
        throw new Error("Retailer not found");
      }
      const retailerUID = retailer.outletUID;

      let apiSuccess = false;
      let apiResponse = null;
      let body = {
        outlet_id: retailerUID,
        amount: point,
        remarks: remark,
        type: "SALES",
        entry_date: moment(transaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, body);
        if (earnPointsResponse.data?.error) {
          apiSuccess = false;
          apiResponse = earnPointsResponse.data;
        } else {
          apiSuccess = true;
        }
      } catch (err) {
        apiSuccess = false;
        apiResponse = {
          errorResponse: err?.response?.data,
        };
      }

      if (apiSuccess) {
        transaction.status = "Success";
        transaction.apiResponse = null;
        transaction.save();
        res.status(200).json({
          message: "Transaction done successfully",
          transaction,
        });
      } else {
        transaction.apiResponse = apiResponse;
        transaction.status = "Failed";
        transaction.save();

        res.status(500);
        throw new Error("Failed to do the transaction");
      }
    } else if (transactionFor === "Sales Return") {
      const retailerId = transaction.retailerId;
      const point = transaction.point;
      const remark = transaction.remark;

      const retailer = await OutletApproved.findById(retailerId);
      if (!retailer) {
        res.status(404);
        throw new Error("Retailer not found");
      }

      const body = {
        outlet_id: retailer.outletUID,
        amount: point,
        remarks: remark,
        type: "Sales Return",
        entry_date: moment(transaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const salesReturnResponse = await axios.post(RBP_POINT_DEBIT_API, body);

        if (salesReturnResponse.data?.error) {
          transaction.status = "Failed";
          transaction.apiResponse = salesReturnResponse.data;
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

      res.status(200).json({
        error: false,
        message: "Transaction retried successfully",
      });
    } else {
      res.status(400);
      throw new Error("Invalid transaction type");
    }
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { retryDistributorTransaction };
