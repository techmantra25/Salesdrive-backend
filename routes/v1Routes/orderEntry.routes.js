const express = require("express");
const {
  createOrderEntry,
} = require("../../controllers/orderEntry/createOrderEntry.js");
const {
  paginatedOrderEntry,
} = require("../../controllers/orderEntry/paginatedOederEntry.js");

const {
  detailOrderEntry,
} = require("../../controllers/orderEntry/detailOrderEntry.js");

const {
  updateOrderEntry,
} = require("../../controllers/orderEntry/updateOrderEntry.js");

const {
  paginatedOrderEntryReport,
} = require("../../controllers/orderEntry/paginatedOrderEntryReport.js");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  paginatedOrderEntryReportForCSP,
} = require("../../controllers/orderEntry/paginatedOrderEntryReportForCSP.js");
const { protectRoute,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { paginatedAllDistributorOrders } = require("../../controllers/orderEntry/paginatedAllDistributorOrders.js");
const { generateSalesOrderReport } = require("../../controllers/orderEntry/generateSalesOrderReport.js");
const {
  salesOrderPrintPDF,
} = require("../../controllers/orderEntry/salesOrderPrintPDF.js");
const orderEntryRoutes = express.Router();

orderEntryRoutes.route("/create").post(protectDisRoute, createOrderEntry);
orderEntryRoutes
  .route("/paginated-list")
  .get(protectDisRoute, paginatedOrderEntry);

orderEntryRoutes.route("/detail/:id").get(protect, detailOrderEntry);

orderEntryRoutes.route("/update/:id").patch(protectDisRoute, updateOrderEntry);

orderEntryRoutes
  .route("/paginated-report")
  .get(protectDisRoute, paginatedOrderEntryReport);

orderEntryRoutes
  .route("/paginated-report-for-csp")
  .get(protect, paginatedOrderEntryReportForCSP);

  orderEntryRoutes
  .route("/all-distributors-order-list")
  .get(protectRoute, authorizeRoles(), paginatedAllDistributorOrders);

orderEntryRoutes
  .route("/generate-report")
  .get(protectRoute, generateSalesOrderReport);

orderEntryRoutes
  .route("/sales-order-print-pdf/:orderEntryId")
  .get(protect, salesOrderPrintPDF);

module.exports = orderEntryRoutes;
