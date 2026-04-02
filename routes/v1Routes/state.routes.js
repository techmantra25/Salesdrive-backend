const express = require("express");
const {
  createState,
  detailState,
  StateUpdate,
  allList,
  listByZone,
} = require("../../controllers/state.controller.js");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const stateRoutes = express.Router();

stateRoutes.route("/create").post(protectRoute, isAdmin, createState);
stateRoutes.route("/list").get(protect, allList);
stateRoutes.route("/listby-zone/:zid").get(protect, listByZone);
stateRoutes.route("/detail/:sid").get(protect, detailState);
stateRoutes.route("/update/:sid").patch(protectRoute, isAdmin, StateUpdate);

module.exports = stateRoutes;
