const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const distributorApprovalAction = require("../../controllers/distributorApproval/distributorApprovalAction");
const getDistributorApprovalList = require("../../controllers/distributorApproval/distributorApprovalList");
const getGiftOrderApprovalDetails = require("../../controllers/distributorApproval/giftOrderApprovalDetails");

const distributorApprovalRoutes = express.Router();

distributorApprovalRoutes
  .route("/action")
  .post(protectDisRoute, distributorApprovalAction);

distributorApprovalRoutes
  .route("/list")
  .get(protectDisRoute, getDistributorApprovalList);

module.exports = distributorApprovalRoutes;