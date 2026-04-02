const express = require("express");

const { protectRoute, isAdmin, authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  createCatalogue,
  getCatalogueDetail,
  updateCatalogue,
  listCatalogues,
} = require("../../controllers/catalogue.controller.js");

const catalogueRoutes = express.Router();

// Create a new catalogue (admin only)
catalogueRoutes
  .route("/create-catalogue")
  .post(protectRoute,  authorizeRoles(), createCatalogue);

// Get catalogue detail
catalogueRoutes.route("/detail-catalogue/:id").get(protect, getCatalogueDetail);

// Update catalogues (admin only)
catalogueRoutes
  .route("/update-catalogue/:id")
  .patch(protectRoute, authorizeRoles(), updateCatalogue);

// Get list of Catalogues
catalogueRoutes.route("/catalogue-list").get(listCatalogues);

module.exports = catalogueRoutes;
