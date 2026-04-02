const express = require("express");
const {
  protectRoute,
  isAdmin,
} = require("../../middlewares/protectRoute");
const getGiftOrderFlow = require("../../controllers/configuregiftflow/flowlist");
const toggleDirectDistributorCancel = require("../../controllers/configuregiftflow/updateflow");

const configureGiftFlowRoutes = express.Router();

// Route to get gift order flow configuration
configureGiftFlowRoutes
  .route("/get-flow")
  .get(protectRoute, isAdmin, getGiftOrderFlow);

// Route to toggle direct distributor cancel setting
configureGiftFlowRoutes
  .route("/toggle-cancel")
  .patch(protectRoute, isAdmin, toggleDirectDistributorCancel);

module.exports = configureGiftFlowRoutes;
