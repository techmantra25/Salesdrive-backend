const express = require("express");

const {
  createSubDivision,
} = require("../../controllers/SubDivision/createSubDivision.js");
const {
  updateSubDivision,
} = require("../../controllers/SubDivision/updateSubDivision.js");
const { allList } = require("../../controllers/SubDivision/subDivisionList.js");
const {
  detailSubDivision,
} = require("../../controllers/SubDivision/detailSubDivision.js");

const { protect } = require("../../middlewares/auth.middleware.js");

const subDivisionRoutes = express.Router();

subDivisionRoutes
  .route("/sub-division-create")
  .post(protect, createSubDivision);
subDivisionRoutes.route("/sub-division-list").get(protect, allList);
subDivisionRoutes
  .route("/sub-division-detail/:sid")
  .get(protect, detailSubDivision);
subDivisionRoutes
  .route("/sub-division-update/:sid")
  .patch(protect, updateSubDivision);

module.exports = subDivisionRoutes;
