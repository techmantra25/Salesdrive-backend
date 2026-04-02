const express = require("express");
const {
  createZone,
  allList,
  detailZone,
  updateZone,
} = require("../../controllers/zone.controller");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const zoneRoutes = express.Router();

zoneRoutes.route("/create").post(protectRoute, isAdmin, createZone);
zoneRoutes.route("/list").get(protect, allList);
zoneRoutes.route("/detail/:zid").get(protect, detailZone);
zoneRoutes.route("/update/:zid").patch(protectRoute, isAdmin, updateZone);

module.exports = zoneRoutes;
