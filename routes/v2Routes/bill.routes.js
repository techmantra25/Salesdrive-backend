const express = require("express");
const {
  deliverBillUpdate,
  retryBillAdjustments,
} = require("../../controllers/RBP-controller/bill/deliverBillUpdate");

const {
  billBulkRetry,
} = require("../../controllers/RBP-controller/bill/billBulkRetry");
const {
  autoPendingBillDelivery,
} = require("../../controllers/RBP-controller/bill/autoPendingBillDelivery.controller");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const billRoutes = express.Router();

billRoutes
  .route("/deliver_bill_update")
  .patch(protectDisRoute, deliverBillUpdate);

billRoutes
  .route("/retry_bill_adjustments")
  .patch(protectDisRoute, retryBillAdjustments);

billRoutes.route("/bulk-retry-partially-delivered-bills").post(billBulkRetry);

billRoutes.route("/auto-deliver-pending-bills").post(autoPendingBillDelivery);

module.exports = billRoutes;
