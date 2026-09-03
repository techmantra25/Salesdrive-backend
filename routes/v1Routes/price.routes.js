const express = require("express");
const {
  addPrice,
  priceDetail,
  updatePrice,
  PriceALList,
  PriceList,
  PriceALListPaginated,
  PriceCategoryDateWiseMatrix,
  PriceProductDateWiseMatrix,
  PriceCategoryDateWiseMatrixExport,
  PriceProductDateWiseMatrixExport,
  pricingStatusBulkUpdate,
  InactivePriceByExpiredDate,
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
priceRoutes
  .route("/inactive-price-by-expired-date")
  .put(InactivePriceByExpiredDate);
priceRoutes.route("/all-list-paginated").get(protect, PriceALListPaginated);
priceRoutes
  .route("/category-date-wise-matrix")
  .get(protect, PriceCategoryDateWiseMatrix);
priceRoutes.route("/product-date-wise-paginated").get(protect, PriceProductDateWiseMatrix);

// Date-wise matrix — full (unpaginated) Excel export, filtered the same way
// as the paginated matrix endpoints above. Placed right next to them so the
// filter/route shape stays easy to keep in sync.
priceRoutes
  .route("/category-date-wise-matrix/export")
  .get(protect, PriceCategoryDateWiseMatrixExport);
priceRoutes
  .route("/product-date-wise-paginated/export")
  .get(protect, PriceProductDateWiseMatrixExport);

priceRoutes.route("/price-download").get(protect, priceDownload);

priceRoutes.route("/list").get(protect, PriceList);
priceRoutes.route("/all-list").get(protect, PriceALList);
priceRoutes.route("/detail/:priceId").get(protect, priceDetail);
priceRoutes.route("/all-list-report").get(protect, PricingAllListReport);
priceRoutes.route("/product-pricing/:productId").get(ProductPricing);
priceRoutes.route("/internal/product-pricing/:productId").get(ProductPricing);
module.exports = priceRoutes;