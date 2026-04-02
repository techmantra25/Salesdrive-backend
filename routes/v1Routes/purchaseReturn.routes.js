const express = require("express");
const {
  createPurchaseReturn,
} = require("../../controllers/purchaseReturn.js/createPurchaseReturn");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  detailPurchaseReturn,
} = require("../../controllers/purchaseReturn.js/detailPurchaseReturn");
const {
  purchaseReturnPaginatedList,
} = require("../../controllers/purchaseReturn.js/purchaseReturnPaginatedList");
const {
  updatePurchaseReturn,
} = require("../../controllers/purchaseReturn.js/updatePurchaseReturn");
const {
  purchaseReturnPrintPDF,
} = require("../../controllers/purchaseReturn.js/purchaseReturnPrintPDF");

const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute.js");

const purchaseReturnRoutes = express.Router();

purchaseReturnRoutes
  .route("/create-purchase-return")
  .post(protectDisRoute, createPurchaseReturn);
purchaseReturnRoutes
  .route("/detail-purchase-return/:id")
  .get(protect, detailPurchaseReturn);
purchaseReturnRoutes
  .route("/paginated-purchase-return-list")
  .get(protect, purchaseReturnPaginatedList);
purchaseReturnRoutes
  .route("/update-purchase-return/:prId")
  .patch(protectRoute,authorizeRoles(), updatePurchaseReturn);
purchaseReturnRoutes
  .route("/purchase-return-print-pdf/:purchaseReturnId")
  .get(protect, purchaseReturnPrintPDF);

module.exports = purchaseReturnRoutes;
