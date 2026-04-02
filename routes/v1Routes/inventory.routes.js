const express = require("express");
const {
  createInventory,
} = require("../../controllers/inventory/createInventory");

const {
  inventoryPaginatedList,
} = require("../../controllers/inventory/inventoryPaginatedList");

const {
  inventoryDetail,
} = require("../../controllers/inventory/detailInventory");

const {
  bulkInventoryStock,
} = require("../../controllers/inventory/bulkInventoryStock");

const {
  bulkStockAdjustment,
} = require("../../controllers/inventory/bulkStockAdjustment");

const {
  bulkAdjustment,
} = require("../../controllers/inventory/bulkAdjustment");

const {
  generateCsv,
} = require("../../controllers/inventory/openingStrockTemplate");

const {
  bulkOpeningStock,
} = require("../../controllers/inventory/openingStockAdd");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  getStockProduct,
} = require("../../controllers/inventory/getStockProduct");
const {
  inventoryPaginatedListReport,
} = require("../../controllers/inventory/inventoryPaginatedListReport");
const {
  syncInventoryWithProductMaster,
} = require("../../controllers/inventory/syncInventoryWithProductMaster");
const {
  allInventoriesPaginatedListReport,
} = require("../../controllers/inventory/allInventoriesPaginatedListReport");

const inventoryRoutes = express.Router();

inventoryRoutes.route("/create").post(protect, createInventory);

inventoryRoutes
  .route("/all-paginatedList")
  .get(protectDisRoute, inventoryPaginatedList);

inventoryRoutes
  .route("/all-paginatedList-report")
  .get(protect, inventoryPaginatedListReport);

inventoryRoutes
  .route("/all-inventories-paginatedList-report")
  .get(protect, allInventoriesPaginatedListReport);

inventoryRoutes.route("/detail/:inventoryId").get(protect, inventoryDetail);

inventoryRoutes
  .route("/bulk-inv-stock")
  .post(protectDisRoute, bulkInventoryStock);

inventoryRoutes
  .route("/bulk-stock-adjustment")
  .post(protectDisRoute, bulkStockAdjustment);

inventoryRoutes.route("/adjustment").post(protectDisRoute, bulkAdjustment);

inventoryRoutes.route("/generate-csv").get(protectDisRoute, generateCsv);

inventoryRoutes.route("/get-stock-product/:productId").get(getStockProduct);

inventoryRoutes
  .route("/sync-inventory-with-product-master")
  .get(protectDisRoute,syncInventoryWithProductMaster);

inventoryRoutes
  .route("/opening-stock-add")
  .post(protectDisRoute, bulkOpeningStock);

module.exports = inventoryRoutes;
