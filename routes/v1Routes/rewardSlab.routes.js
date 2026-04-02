const express = require("express");
const {
  getRewardSlabs,
  updateRewardSlabs,
} = require("../../controllers/rewardSlab/rewardSlab.controller");
const { isAdmin, protectRoute } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const rewardSlabRoutes = express.Router();

// Route to get all reward slabs
rewardSlabRoutes.route("/get-reward-slabs").get(getRewardSlabs);

// Route to update reward slabs
rewardSlabRoutes
  .route("/update-reward-slabs")
  .patch(protectRoute, isAdmin, updateRewardSlabs);

module.exports = rewardSlabRoutes;
