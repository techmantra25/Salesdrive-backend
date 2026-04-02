const express = require("express");
const {
  createRegion,
  detailRegion,
  RegionUpdate,
  allList,
  listByZone,
} = require("../../controllers/region.controller.js");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const regionRoutes = express.Router();

regionRoutes.route("/create").post(protectRoute, isAdmin, createRegion);
regionRoutes.route("/list").get(protect, allList);
regionRoutes.route("/list-by-zone/:zid").get(protect, listByZone);
regionRoutes.route("/detail/:rid").get(protect, detailRegion);
regionRoutes.route("/update/:rid").patch(protectRoute, isAdmin, RegionUpdate);

module.exports = regionRoutes;
