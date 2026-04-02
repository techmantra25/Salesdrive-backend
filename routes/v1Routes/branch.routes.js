const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const { createBranch } = require("../../controllers/branch/createBranch");
const { updateBranch } = require("../../controllers/branch/updateBranch");
const { listBranch } = require("../../controllers/branch/listBranch");
const { detailBranch } = require("../../controllers/branch/detailBranch");

const branchRoutes = express.Router();

branchRoutes.route("/create-branch").post(protectDisRoute, createBranch);
branchRoutes.route("/update-branch/:id").patch(protectDisRoute, updateBranch);
branchRoutes.route("/list-branch").get(protect, listBranch);
branchRoutes.route("/detail-branch/:id").get(protect, detailBranch);

module.exports = branchRoutes;
