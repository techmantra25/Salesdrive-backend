const express = require("express");
const {
  protectRoute,
  isAdmin,
  authorizeRoles,
} = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  priceCSVPaginatedList,
} = require("../../controllers/priceCSV/priceCSVPaginatedList");
const {
  priceCSVStatusUpdate,
} = require("../../controllers/priceCSV/priceCSVStatusUpdate");
const {
  autoApprovePriceCSV,
} = require("../../controllers/priceCSV/autoApprovePriceCSV");

const priceCSVRoutes = express.Router();

priceCSVRoutes
  .route("/paginated-list")
  .get(
    protect,
    priceCSVPaginatedList
  );
priceCSVRoutes
  .route("/handle-status-update")
  .post(
    //protectRoute,
   // authorizeRoles("admin"),
    protect,
    priceCSVStatusUpdate
  );
priceCSVRoutes.route("/auto-approve-price-csv").get(autoApprovePriceCSV);

module.exports = priceCSVRoutes;
