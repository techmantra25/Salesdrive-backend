const express = require("express");
const { createReason } = require("../../controllers/reason/createReason.js");
const { reasonList } = require("../../controllers/reason/listReason.js");
const {
  reasonListbyModule,
} = require("../../controllers/reason/listbyModule.js");
const {
  reasonstatusUpdate,
} = require("../../controllers/reason/statusUpdate.js");
const { reasonDelete } = require("../../controllers/reason/deleteReason.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const reasonRoutes = express.Router();

reasonRoutes.route("/create").post(protect, createReason);
reasonRoutes.route("/list").get(protect, reasonList);
reasonRoutes.route("/list-by-module").get(protectDisRoute, reasonListbyModule);
reasonRoutes
  .route("/module/:moduleName")
  .get(protectDisRoute, reasonListbyModule);
reasonRoutes.route("/status-update/:rid").patch(protect, reasonstatusUpdate);
reasonRoutes.route("/delete/:rid").delete(protect, reasonDelete);

module.exports = reasonRoutes;
