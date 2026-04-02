const express = require("express");

const {
  createPurchaseOrder,
} = require("../../controllers/purchaseOrder/createPurchaseOrder.js");

const {
  detailPurchaseOrder,
} = require("../../controllers/purchaseOrder/detailPurchaseOrder.js");

const {
  updatePurchaseOrder,
} = require("../../controllers/purchaseOrder/updatePurchaseOrder.js");

const {
  paginatedPurchaseOrderList,
} = require("../../controllers/purchaseOrder/purchaseOrderPaginatedList.js");

const {
  paginatedPurchaseOrderListForEmp,
} = require("../../controllers/purchaseOrder/paginatedListForEmp.js");

const protectEmployeeRoute = require("../../middlewares/protectEmployeeRoute.js");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const {
  updatePurchaseOrderByEmp,
} = require("../../controllers/purchaseOrder/updatedPurchaseOrderByEmp.js");

const {
  statusUpdateByEmp,
} = require("../../controllers/purchaseOrder/statusUpdateByEmp.js");
const protectAdminOrEmployeeRoute = require("../../middlewares/protectAdminOrEmployeeRoute.js");
const {
  purchaseOrderExcelView,
} = require("../../controllers/purchaseOrder/purchaseOrderExcelView.js");
const {
  purchaseOrderExcelViewByEmp,
} = require("../../controllers/purchaseOrder/purchaseOrederExcelViewbyEmp.js");
const {
  sendQuotation,
} = require("../../controllers/purchaseOrder/sendQuotation.js");
const { poReport } = require("../../controllers/purchaseOrder/poReport.js");
const { printPO } = require("../../controllers/purchaseOrder/printPO.js");

const purchaseOrderRoutes = express.Router();

purchaseOrderRoutes.route("/create-purchase-order").post(protect, createPurchaseOrder);

purchaseOrderRoutes
  .route("/detail-purchase-order/:purchaseOrderId")
  .get(protect, detailPurchaseOrder);

purchaseOrderRoutes
  .route("/update-purchase-order/:purchaseOrderId")
  .patch(protectDisRoute, updatePurchaseOrder);

purchaseOrderRoutes
  .route("/paginated-purchase-order-list")
  .get(protect, paginatedPurchaseOrderList);

purchaseOrderRoutes
  .route("/paginated-purchase-order-list-for-emp")
  .get(protectAdminOrEmployeeRoute, paginatedPurchaseOrderListForEmp);

purchaseOrderRoutes
  .route("/update-purchase-order-by-emp-or-admin/:purchaseOrderId")
  .patch(protectAdminOrEmployeeRoute, updatePurchaseOrderByEmp);

purchaseOrderRoutes
  .route("/status-update-by-emp-or-admin/:purchaseOrderId")
  .patch(protectAdminOrEmployeeRoute, statusUpdateByEmp);

purchaseOrderRoutes
  .route("/send-quotation/:purchaseOrderId")
  .get(sendQuotation);

purchaseOrderRoutes
  .route("/purchase-order-excel-view")
  .get(protect, purchaseOrderExcelView);

purchaseOrderRoutes
  .route("/purchase-order-excel-view-by-emp")
  .get(protectEmployeeRoute, purchaseOrderExcelViewByEmp);

purchaseOrderRoutes.route("/po-report").get(protect, poReport);
purchaseOrderRoutes.route("/print-po/:purchaseOrderId").get(protect, printPO);

module.exports = purchaseOrderRoutes;
