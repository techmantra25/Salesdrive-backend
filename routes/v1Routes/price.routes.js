const express = require("express");
const {
  addPrice,
  priceDetail,
  updatePrice,
  PriceALList,
  PriceList,
  PriceALListPaginated,
  pricingStatusBulkUpdate,
  PricingAllListReport,
  ProductPricing,
  addDBPriceByDB,
} = require("../../controllers/price.controller.js");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { priceDownload } = require("../../controllers/Price/priceDownload.js");

const priceRoutes = express.Router();

priceRoutes.route("/add").post(protectRoute, isAdmin, addPrice);
priceRoutes.route("/add-db-price-by-db").post(protectDisRoute, addDBPriceByDB);
priceRoutes.route("/update/:priceId").patch(protectRoute, isAdmin, updatePrice);
priceRoutes.route("/bulk-update-status").put(pricingStatusBulkUpdate);
priceRoutes.route("/all-list-paginated").get(protect, PriceALListPaginated);
priceRoutes.route("/price-download").get(protect, priceDownload);

priceRoutes.route("/list").get(protect, PriceList);
priceRoutes.route("/all-list").get(protect, PriceALList);
priceRoutes.route("/detail/:priceId").get(protect, priceDetail);
priceRoutes.route("/all-list-report").get(protect, PricingAllListReport);
priceRoutes.route("/product-pricing/:productId").get(ProductPricing);
priceRoutes.route("/internal/product-pricing/:productId").get(ProductPricing);
module.exports = priceRoutes;
