const express = require("express");
const {
  createOrderEnquiry,
} = require("../../controllers/orderEnquiry/createOrderEnquiry.js");
const {
  bulkCreateOrderEnquiry,
} = require("../../controllers/orderEnquiry/bulkCreateOrderEnquiry .js");
const {
  paginatedOrderEnquiry,
} = require("../../controllers/orderEnquiry/paginatedOrderEnquiry.js");
const {
  detailOrderEnquiry,
} = require("../../controllers/orderEnquiry/detailOrderEnquiry.js");
const {
  updateOrderEnquiry,
} = require("../../controllers/orderEnquiry/updateOrderEnquiry.js");
const {
  editOrderEnquiry,
} = require("../../controllers/orderEnquiry/editOrderEnquiry.js");
const {
  convertOrderEnquiryToOrderEntry,
} = require("../../controllers/orderEnquiry/convertOrderEnquiryToOrderEntry.js");
const {
  orderEnquiryPrintPDF,
} = require("../../controllers/orderEnquiry/orderEnquiryPrintPDF.js");
const {
  generateSalesEnquiryReport,
} = require("../../controllers/orderEnquiry/generateSalesEnquiryReport.js");
const { paginatedSalesEnquiryList } = require("../../controllers/orderEnquiry/paginatedSalesEnquiryList.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const { closeOrderEnquiry } = require("../../controllers/orderEnquiry/closedOrderEnquiry.js");
const {
  remarksOrderEnquiry,
} = require("../../controllers/orderEnquiry/remarksOrderEnquiry.js");
const {
  viewRemarksOrderEnquiry,
} = require("../../controllers/orderEnquiry/viewRemarksOrderEnquiry.js");

const orderEnquiryRoutes = express.Router();

orderEnquiryRoutes.route("/create").post(protectDisRoute, createOrderEnquiry);
orderEnquiryRoutes
  .route("/bulk-create")
  .post(protectDisRoute, bulkCreateOrderEnquiry);
orderEnquiryRoutes
  .route("/paginated-list")
  .get(protectDisRoute, paginatedOrderEnquiry);
orderEnquiryRoutes.route("/detail/:id").get(protect, detailOrderEnquiry);
orderEnquiryRoutes.route("/update/:id").patch(protectDisRoute, updateOrderEnquiry);
orderEnquiryRoutes.route("/edit/:id").patch(protectDisRoute, editOrderEnquiry);
orderEnquiryRoutes
  .route("/convert-to-order-entry/:id")
  .post(protectDisRoute, convertOrderEnquiryToOrderEntry);
orderEnquiryRoutes
  .route("/order-enquiry-print-pdf/:orderEnquiryId")
  .get(protect, orderEnquiryPrintPDF);

orderEnquiryRoutes
  .route("/generate-report")
  .get(protect, generateSalesEnquiryReport);

orderEnquiryRoutes
  .route("/paginated-sales-enquiry-list")
  .get(protect, paginatedSalesEnquiryList);

orderEnquiryRoutes.patch(
  "/closed-order-enquiry/:id",
  protectDisRoute,
  closeOrderEnquiry
);

orderEnquiryRoutes.patch(
  "/remarks-order-enquiry/:id",
  protectDisRoute,
  remarksOrderEnquiry
);

orderEnquiryRoutes.get(
  "/remarks-order-enquiry/:id",
  protect,
  viewRemarksOrderEnquiry
);

module.exports = orderEnquiryRoutes;