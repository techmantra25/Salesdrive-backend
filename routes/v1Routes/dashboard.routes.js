const express = require("express");
const {
  StatisticsCount,
} = require("../../controllers/dashboard/StatisticsCount");
const { disDashCount } = require("../../controllers/dashboard/disDashCount");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  distributorDashboardCount,
} = require("../../controllers/dashboard/distributorDashboardCount");
const {
  getDashboardStats,
} = require("../../controllers/dashboard/getDashboardStats.controller");


const dashboardRoutes = express.Router();

dashboardRoutes.route("/count").get(protect, StatisticsCount);
dashboardRoutes.route("/dis-dash-count").get(protectDisRoute, disDashCount);

dashboardRoutes.route("/stats").get(protectDisRoute, getDashboardStats);
dashboardRoutes
  .route("/distributor-dashboard-count")
  .get(protect, distributorDashboardCount);

module.exports = dashboardRoutes;
