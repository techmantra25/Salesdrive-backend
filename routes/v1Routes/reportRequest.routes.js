const express = require("express");
const {
  reportRequestList,
} = require("../../controllers/reportRequest/reportRequestList");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  reportRequest,
} = require("../../controllers/reportRequest/reportRequest");
const reportRouter = express.Router();

reportRouter.route("/distributer-request").post(protectDisRoute, reportRequest);
reportRouter.route("/distributor-list").get(protect, reportRequestList);

module.exports = reportRouter;
