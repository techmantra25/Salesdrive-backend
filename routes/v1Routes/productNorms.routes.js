const express = require("express");
const {
  createProductNorm,
  updateProductNorm,
  getProductNormsPaginated,
  getProductNormById,
  getProductNormByDistributorId,
} = require("../../controllers/productNorms.controller");
const { protect } = require("../../middlewares/auth.middleware.js");
const productNormsRoutes = express.Router();

// Create a new product norm
productNormsRoutes.post("/create_product_norm", protect, createProductNorm);

// Update a product norm
productNormsRoutes.patch("/update_product_norm/:id", protect, updateProductNorm);

// Get all product norms (paginated)
productNormsRoutes.get("/get_product_norm_paginated", protect, getProductNormsPaginated);

// Get product norm by ID
productNormsRoutes.get("/get_product_norm_by_id/:id", protect, getProductNormById);

// Get product norm by distributor ID and product ID
productNormsRoutes.get(
  "/get_product_norm_by_db_id_and_product_id/distributor/:distributorId/product/:productId",
  getProductNormByDistributorId
);

module.exports = productNormsRoutes;
