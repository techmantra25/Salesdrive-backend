const express = require("express");
const {
  createOrderEnquiry,
} = require("../../controllers/orderEnquiry/createOrderEnquiry.js");
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
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const orderEnquiryRoutes = express.Router();

orderEnquiryRoutes.route("/create").post(protectDisRoute, createOrderEnquiry);
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

module.exports = orderEnquiryRoutes;
