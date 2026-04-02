const express = require("express");
const protectRetailerRoute = require("../../middlewares/ptotectReatilerRoute");
const createGiftOrder = require("../../controllers/giftOrderController/createGiftOrder");
const removeGiftProductFromOrder = require("../../controllers/giftOrderController/removeProduct");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const updatetoNoc = require("../../controllers/giftOrderController/updatetoNoc");
const statusUpdate = require("../../controllers/giftOrderController/statusUpdate");
const listGiftOrders = require("../../controllers/giftOrderController/listGiftOrders");
const detailGiftOrder = require("../../controllers/giftOrderController/detailGiftOrder");
const retailerGiftOrders = require("../../controllers/giftOrderController/retailerGiftList");
const { protectRoute, isAdmin,authorizeRoles } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const cancelOrder = require("../../controllers/giftOrderController/cancelOrder");
const createOrderWithDB = require("../../controllers/giftOrderController/createOrderWithDB");
const { downloadGiftOrdersCSV } = require("../../controllers/giftOrderController/giftOrderCsvDownload");
const downloadDistributorGiftOrdersCSV =
  require("../../controllers/distributorApproval/downloadDistributorGiftOrdersCSV");
const { fixSingleOrderApprovals } = require("../../controllers/giftOrderController/fixMissingApprovals");



const giftOrderRoutes = express.Router();

// giftOrderRoutes
//   .route("/create-gift-order")
//   .post(protectRetailerRoute, createGiftOrder);

giftOrderRoutes
  .route("/create-gift-order")
  .post(protectRetailerRoute, createOrderWithDB);

giftOrderRoutes
  .route("/remove-product/:id")
  .post(protectRetailerRoute, removeGiftProductFromOrder);

giftOrderRoutes.route("/update-to-noc/:id").patch(protectDisRoute, updatetoNoc);

giftOrderRoutes.route("/status-update/:id").patch(protectRoute, authorizeRoles(), statusUpdate);

giftOrderRoutes.route("/list").get(protect, listGiftOrders);

giftOrderRoutes.route("/detail/:id").get(protect, detailGiftOrder);

giftOrderRoutes
  .route("/retailer-gift-orders")
  .get(protectRetailerRoute, retailerGiftOrders);

giftOrderRoutes.route("/cancel/:orderId").patch(protectRoute, authorizeRoles(), cancelOrder);

giftOrderRoutes.route("/download-csv").get(protect, downloadGiftOrdersCSV);

giftOrderRoutes
  .route("/distributor-download-csv")
  .get(protectDisRoute, downloadDistributorGiftOrdersCSV);

// Admin route to fix missing approvals for a single order
giftOrderRoutes
  .route("/fix-missing-approvals/:orderId")
  .post(protectRoute, isAdmin, fixSingleOrderApprovals);

module.exports = giftOrderRoutes;
