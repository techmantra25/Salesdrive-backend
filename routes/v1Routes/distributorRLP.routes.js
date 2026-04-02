const express = require("express");
const { bulkUpdateAllowRLPEdit } = require("../../controllers/distributorRLP/distributorRLPSettings");
const { protectRoute, authorizeRoles } = require("../../middlewares/protectRoute.js");

const distributorRLPRoutes = express.Router();

distributorRLPRoutes
  .route("/bulk-update")
  .post(protectRoute, authorizeRoles("admin"), bulkUpdateAllowRLPEdit);

module.exports = distributorRLPRoutes;
