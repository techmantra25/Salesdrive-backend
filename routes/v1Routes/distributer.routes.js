const express = require("express");
const {
  getMe,
  addDistributor,
  loginUser,
  logoutDistributor,
  disList,
  updateDistributor,
  sendCredentialEmail,
  distributorByRegion,
} = require("../../controllers/distributor.controller.js");
const {disListdata} = require("../../controllers/distributorData.controller.js");
const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { loginRateLimiter } = require("../../middlewares/rateLimiter.js");

const distributorRoutes = express.Router();

distributorRoutes.route("/me").get(protectDisRoute, getMe);
distributorRoutes.route("/login").post(loginRateLimiter, loginUser);
distributorRoutes.route("/logout").post(logoutDistributor);
distributorRoutes.route("/add").post(protectRoute, authorizeRoles(), addDistributor);
distributorRoutes.route("/list").get(protect, disList);
distributorRoutes.route("/listdata").get(protect, disListdata);
distributorRoutes.route("/update").patch(protect, updateDistributor);
distributorRoutes
  .route("/send-credential/:id")
  .post(protectRoute, authorizeRoles(), sendCredentialEmail);

distributorRoutes.route("/list-by-reg/:regId").get(protect, distributorByRegion);

module.exports = distributorRoutes;