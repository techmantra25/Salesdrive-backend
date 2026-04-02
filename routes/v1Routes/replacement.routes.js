const express = require("express");
const {
  detailReplacement,
} = require("../../controllers/replacement/detailReplacement");
const {
  paginatedReplacementList,
} = require("../../controllers/replacement/paginatedReplacement");

const {
  paginatedReplacementReport,
} = require("../../controllers/replacement/paginatedReplacementReport");

const { protect } = require("../../middlewares/auth.middleware.js");

const replacementRoutes = express.Router();

replacementRoutes.route("/detail/:replacementId").get(protect, detailReplacement);

replacementRoutes
  .route("/paginated-replacement-list")
  .get(protect, paginatedReplacementList);

replacementRoutes
  .route("/paginated-replacement-report")
  .get(protect, paginatedReplacementReport);

module.exports = replacementRoutes;
