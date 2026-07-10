const express = require("express");
const { createSingleBill, getBillJobStatus } = require("../../controllers/queueBills/createSingleBill.js");
const {
  multipleBillCreate,
} = require("../../controllers/queueBills/createMultiBill.js");
const { billUpdate } = require("../../controllers/bill/billUpdate");
const { cancelBillUpdate } = require("../../controllers/bill/cancelBillUpdate");
const { getBilledProductsByRetailer } = require("../../controllers/bill/getBilledProductsByRetailer");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");

const billRoutes = express.Router();

billRoutes.route("/create-single-bill").post(protectDisRoute, createSingleBill);
billRoutes.route("/create-bulk-bill").post(protectDisRoute, multipleBillCreate);
billRoutes.route("/bill_update/:bid").patch(protectDisRoute, billUpdate);
billRoutes.route("/cancel_bill_update").patch(protectDisRoute, cancelBillUpdate);
billRoutes.route("/job-status/:jobId").get(protectDisRoute, getBillJobStatus);
billRoutes.route("/billed-products/:retailerId").get(protectDisRoute, getBilledProductsByRetailer);

module.exports = billRoutes;

console.log("Hi there I am V3 route")