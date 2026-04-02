const express = require("express");

const {
  createDesignation,
  allList,
  detailDesignation,
  updateDesignation,
} = require("../../controllers/designation.controller");

const {
  protectRoute,
  authorizeRoles,
  isAdmin,
} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const designationRoutes = express.Router();

designationRoutes.route("/create").post(
  protectRoute,
  authorizeRoles(), // allow all logged-in users
  createDesignation
);

designationRoutes.route("/list").get(protect, allList);

designationRoutes.route("/detail/:desId").get(protect, detailDesignation);

designationRoutes.route("/update/:desId").patch(
  protectRoute,
  authorizeRoles(), // allow all logged-in users
  updateDesignation
);

module.exports = designationRoutes;
