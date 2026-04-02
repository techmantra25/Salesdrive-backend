const express = require("express");

const { createPlant } = require("../../controllers/plant/createPlant.js");

const { detailPlant } = require("../../controllers/plant/detailPlant.js");

const { updatePlant } = require("../../controllers/plant/updatePlant.js");

const {
  paginatedListOfPlant,
} = require("../../controllers/plant/paginatedPlantList.js");

const { protectRoute, authorizeRoles,isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const plantRoutes = express.Router();

plantRoutes.route("/create-plant").post(protectRoute, authorizeRoles(), createPlant);

plantRoutes.route("/detail-plant/:pid").get(protect, detailPlant);

plantRoutes
  .route("/update-plant/:pid")
  .patch(protectRoute, authorizeRoles(), updatePlant);

plantRoutes.route("/paginated-list-plant").get(protect, paginatedListOfPlant);

module.exports = plantRoutes;
