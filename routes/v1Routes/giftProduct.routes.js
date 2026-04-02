const express = require("express");
const {
  createGiftProduct,
  getGiftProductDetail,
  updateGiftProduct,
  paginatedGiftProductList,
  bulkAddGiftProduct
} = require("../../controllers/giftProduct.controller");
const { protectRoute,  authorizeRoles } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const giftProductRoutes = express.Router();

// Create a new gift product (admin only)
giftProductRoutes
  .route("/create-gift-product")
  .post(protectRoute,authorizeRoles(), createGiftProduct);

// Get product detail
giftProductRoutes.route("/detail-gift-product/:id").get(getGiftProductDetail);

// Update gift product (admin only)
giftProductRoutes
  .route("/update-gift-product/:id")
  .patch(protectRoute, authorizeRoles(), updateGiftProduct);

// Get paginated list of gift products
giftProductRoutes
  .route("/paginated-gift-product-list")
  .get(paginatedGiftProductList);

giftProductRoutes.route("/bulk-add-gift-product").post(protect, bulkAddGiftProduct);

module.exports = giftProductRoutes;
