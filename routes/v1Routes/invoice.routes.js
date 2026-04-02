const express = require("express");
const { createInvoice } = require("../../controllers/invoice/createInvoice.js");
const {
  paginatedInvoiceList,
} = require("../../controllers/invoice/paginatedInvoiceList.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const protectAdminOrEmployeeRoute = require("../../middlewares/protectAdminOrEmployeeRoute.js");
const {
  disPaginatedInvoiceList,
} = require("../../controllers/invoice/disPaginatedInvoiceList.js");
const { invoiceDetail } = require("../../controllers/invoice/invoiceDetail.js");
const {
  updateInvoice,
  retryInvoiceAdjustments,
} = require("../../controllers/invoice/updateInvoice.js");
const {
  cronRetryAllFailedInvoiceAdjustments,
} = require("../../controllers/invoice/cronRetryAllFailedInvoiceAdjustments.js");

const {
  paginatedInvoiceReport,
} = require("../../controllers/invoice/paginatedInvoiceReport.js");
const {
  poInvoicePrint,
} = require("../../controllers/invoice/poInvoicePrint.js");

const syncGrnOriginalDateBulk = require("../../controllers/invoice/syncGrnOriginalDate.js");

const {invoiceDetailForSaleReturn} = require("../../controllers/invoice/invoiceDetailForSaleReturn.js");
const { findAndRemoveInvoice } = require("../../controllers/invoice/find-and-remove-invoice.js");
const { paginatedDeletedInvoiceList } = require("../../controllers/invoice/paginatedDeletedInvoiceList.js");

const invoiceRoutes = express.Router();

invoiceRoutes.route("/create-invoice").post(protect, createInvoice);
invoiceRoutes
  .route("/update-invoice/:inId")
  .patch(protectDisRoute, updateInvoice);

invoiceRoutes
  .route("/retry-adjustments/:inId")
  .post(protectDisRoute, retryInvoiceAdjustments);

invoiceRoutes
  .route("/cron-retry-failed-adjustments")
  .post(cronRetryAllFailedInvoiceAdjustments);

invoiceRoutes.route("/invoice-detail/:inId").get(protect, invoiceDetail);
invoiceRoutes.route("/all-paginated-invoice-list").get(protect, paginatedInvoiceList);
invoiceRoutes
  .route("/dis-paginated-invoice-list")
  .get(protectDisRoute, disPaginatedInvoiceList);

invoiceRoutes.route("/paginated-invoice-report").get(protect, paginatedInvoiceReport);
invoiceRoutes.route("/paginated-deleted-invoice-list").get(protectAdminOrEmployeeRoute, paginatedDeletedInvoiceList);

invoiceRoutes.route("/po-invoice-print/:inId").get(protect, poInvoicePrint);
invoiceRoutes.route("/sync-grn-original-date").get(protect, syncGrnOriginalDateBulk);

invoiceRoutes.route("/invoice-detail-for-sale-return/:inId").get(protect, invoiceDetailForSaleReturn);
invoiceRoutes.route("/find-and-remove-invoice").post(protectAdminOrEmployeeRoute, findAndRemoveInvoice);

module.exports = invoiceRoutes;
