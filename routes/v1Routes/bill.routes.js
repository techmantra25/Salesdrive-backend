const express = require("express");
const { createSingleBill } = require("../../controllers/bill/createSingleBill");
const {
  createNewbillSeries,
} = require("../../controllers/bill/createNewbillSeries");
const { updateBillSeries } = require("../../controllers/bill/updateBillSeries");
const { getAllbillSeries } = require("../../controllers/bill/getAllbillSeries");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  paginatedBillList,
} = require("../../controllers/bill/paginatestBillList");
const {
  multipleBillCreate,
} = require("../../controllers/bill/createMultiBill");
const { detailBill } = require("../../controllers/bill/detailBill");
const { getBulkBill } = require("../../controllers/bill/getBulkBill");

const { cancelBillUpdate } = require("../../controllers/bill/cancelBillUpdate");

// const {
//   deliverBillUpdate,
//   retryBillAdjustments,
// } = require("../../controllers/bill/deliverBillUpdate");

// const { billBulkRetry } = require("../../controllers/bill/billBulkRetry");

const { billUpdate } = require("../../controllers/bill/billUpdate");

// new controller import
const { billStatusAndDateUpdate } = require("../../controllers/bill/billStatusandDateUpdate");

const {
  paginatedBillReport,
} = require("../../controllers/bill/paginatedBillReport");
const { billPrintPDF } = require("../../controllers/bill/billPrint");
const {
  paginatedOrderVsBillReport,
} = require("../../controllers/bill/paginatedOrderVsBillReport");

const billRoutes = express.Router();

billRoutes.route("/create-single-bill").post(protectDisRoute, createSingleBill);
billRoutes
  .route("/create-new-billseries")
  .post(protectDisRoute, createNewbillSeries);
billRoutes
  .route("/paginated-bill-list")
  .get(protectDisRoute, paginatedBillList);

billRoutes.route("/create-bulk-bill").post(protectDisRoute, multipleBillCreate);

billRoutes.route("/detail/:billId").get(protect, detailBill);
billRoutes.route("/get-all").get(protect, getAllbillSeries);

billRoutes.route("/get_bulk_bill").post(protect, getBulkBill);

billRoutes.route("/cancel_bill_update").patch(protect, cancelBillUpdate);

// billRoutes
//   .route("/deliver_bill_update")
//   .patch(protectDisRoute, deliverBillUpdate);

// billRoutes
//   .route("/retry_bill_adjustments")
//   .patch(protectDisRoute, retryBillAdjustments);

billRoutes.route("/bill_update/:bid").patch(protectDisRoute, billUpdate);
billRoutes
  .route("/update-billseries/:id")
  .patch(protectDisRoute, updateBillSeries);

billRoutes.route("/paginated_bill_report").get(protect, paginatedBillReport);
billRoutes
  .route("/paginated-order-to-bill-report")
  .get(protect, paginatedOrderVsBillReport);

billRoutes.route("/bill-print/:billId").get(protect, billPrintPDF);

//billRoutes.route("/bulk-retry-partially-delivered-bills").post(protect, billBulkRetry);
// billRoutes.route("/bulk-retry-partially-delivered-bills").post(billBulkRetry);

// route for the new cotroller
billRoutes.route("/bill-status-date-update").patch(protectDisRoute, billStatusAndDateUpdate);

module.exports = billRoutes;
