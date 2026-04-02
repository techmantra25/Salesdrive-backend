const express = require("express");
const {
  createLoadSheet,
} = require("../../controllers/loadSheet/createLoadSheet");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  detailLoadSheet,
} = require("../../controllers/loadSheet/detailLoadSheet");
const {
  loadSheetPrint,
} = require("../../controllers/loadSheet/loadSheetPrint");

const { paginatedList } = require("../../controllers/loadSheet/paginatedList");
const {
  unloadLoadSheet,
} = require("../../controllers/loadSheet/unloadLoadSheet");
const loadSheetRoutes = express.Router();

loadSheetRoutes
  .route("/create-load-sheet")
  .post(protectDisRoute, createLoadSheet);
loadSheetRoutes.route("/detail-load-sheet/:lid").get(protect, detailLoadSheet);
loadSheetRoutes.route("/print-load-sheet").post(protect, loadSheetPrint);
loadSheetRoutes
  .route("/unload-load-sheet")
  .post(protectDisRoute, unloadLoadSheet);
loadSheetRoutes.route("/all-paginated-load-sheet-list").get(protect, paginatedList);

module.exports = loadSheetRoutes;
