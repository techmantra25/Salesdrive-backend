const express = require("express");
const {
  createSalesReturn,
} = require("../../controllers/salesReturn/createSalesReturn");

const {
  createSalesReturnwithoutRef,
} = require("../../controllers/salesReturn/createSalesReturnwithoutRef");

const {
  paginatedSalesReturnList,
} = require("../../controllers/salesReturn/paginatedSalesReturnList");

const {
  detailSalesReturn,
} = require("../../controllers/salesReturn/detailSalesReturn");

const {
  paginatedSalesReturnReport,
} = require("../../controllers/salesReturn/paginatedSalesReturnReport");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  generateSalesReturnReport,
} = require("../../controllers/salesReturn/salesReturnReport");
const {
  distributorSalesReturnReport,
} = require("../../controllers/salesReturn/distributorSalesReturnReport");

const { salesReturnPrintPDF } = require("../../controllers/salesReturn/salesReturnPrintPDF");

const salesReturnRoutes = express.Router();

salesReturnRoutes
  .route("/create-sales-return")
  .post(protectDisRoute, createSalesReturn);

salesReturnRoutes
  .route("/create-sales-return-without-ref")
  .post(protectDisRoute, createSalesReturnwithoutRef);

salesReturnRoutes
  .route("/paginated-sales-return-list")
  .get(protect, paginatedSalesReturnList);

salesReturnRoutes
  .route("/paginated-sales-return-report")
  .get(protect, paginatedSalesReturnReport);

salesReturnRoutes.route("/detail/:salesReturnId").get(protect, detailSalesReturn);
salesReturnRoutes
  .route("/all-sales-return-report")
  .get(protect, generateSalesReturnReport);
salesReturnRoutes
  .route("/distributor-sales-return-report")
  .get(protect, distributorSalesReturnReport);

  salesReturnRoutes.route("/sales-return-print-pdf/:salesReturnId").get(protect, salesReturnPrintPDF);

module.exports = salesReturnRoutes;
