const express = require("express");
const { passwordDetail } = require("../../controllers/password.controller.js");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");

const passwordRoutes = express.Router();

passwordRoutes
  .route("/data/:userId")
  .get(protectRoute, isAdmin, passwordDetail);

module.exports = passwordRoutes;
