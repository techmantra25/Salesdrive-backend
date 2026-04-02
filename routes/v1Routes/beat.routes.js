const express = require("express");
const { protectRoute,authorizeRoles, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { createBeat } = require("../../controllers/beat/createBeat.js");
const { detailBeat } = require("../../controllers/beat/detailBeat.js");
const { allBeats } = require("../../controllers/beat/allBeats.js");
const {
  listByDistributor,
} = require("../../controllers/beat/listByDistributor.js");
const { listByRegion } = require("../../controllers/beat/listByRegion.js");
const { updateBeat } = require("../../controllers/beat/updateBeat.js");
const {
  beatAllListPaginated,
} = require("../../controllers/beat/beatAllListPaginated.js");
const { beatReport } = require("../../controllers/beat/beatReport.js");
const { listByEmpId } = require("../../controllers/beat/listByEmpId.js");
const {
  updateBeatDistributors,
} = require("../../controllers/beat/updateBeatDistributors.js");

const beatRoutes = express.Router();

beatRoutes.route("/create").post(protectRoute, authorizeRoles(), createBeat);
beatRoutes.route("/list").get(protect, allBeats);
beatRoutes.route("/beat-list-paginated").get(protect, beatAllListPaginated);
beatRoutes.route("/beat-report").get(protect, beatReport);
beatRoutes.route("/detail/:bid").get(protect, detailBeat);
beatRoutes.route("/update/:bid").patch(protectRoute, authorizeRoles(), updateBeat);
beatRoutes.route("/list-by-distributor/:did").get(protect, listByDistributor);
beatRoutes.route("/list-by-region/:regionId").get(protect, listByRegion);
beatRoutes.route("/list-by-empId/:empId").get(protect, listByEmpId);
beatRoutes
  .route("/update-distributors/:beatId")
  .patch(protectRoute, authorizeRoles(), updateBeatDistributors);

module.exports = beatRoutes;
