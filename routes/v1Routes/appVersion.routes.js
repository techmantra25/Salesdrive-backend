const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { createAppVersion } = require("../../controllers/appVersion/createAppVersion.js");
const { detailAppVersion } = require("../../controllers/appVersion/detailAppVersion.js");
const { updateAppVersion } = require("../../controllers/appVersion/updateAppVersion.js");
const { listAppVersion } = require("../../controllers/appVersion/listAppVersion.js");
const { getLatestVersion } = require("../../controllers/appVersion/getLatestVersion.js");
const { protectRoute } = require("../../middlewares/protectRoute");

const appVersionRoutes = express.Router();

appVersionRoutes.route("/create").post(protectRoute, createAppVersion);

appVersionRoutes.route("/detail/:appVersionId").get(protectRoute, detailAppVersion);

appVersionRoutes.route("/update/:appVersionId").patch(protectRoute, updateAppVersion);

appVersionRoutes.route("/list").get(protectRoute, listAppVersion);

appVersionRoutes.route("/latest").get(getLatestVersion);

module.exports = appVersionRoutes;
