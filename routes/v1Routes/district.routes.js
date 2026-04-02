const express = require("express");

const {
  createDistrict,
} = require("../../controllers/District/createDistrict.js");
const {
  updateDistrict,
} = require("../../controllers/District/updateDistrict.js");
const { allList } = require("../../controllers/District/districtlist.js");
const {
  detailDistrict,
} = require("../../controllers/District/detailDistrict.js");

const { protect } = require("../../middlewares/auth.middleware.js");

const districtRoutes = express.Router();

districtRoutes.route("/district-create").post(protect, createDistrict);
districtRoutes.route("/district-list").get(protect, allList);
districtRoutes.route("/district-detail/:did").get(protect, detailDistrict);
districtRoutes.route("/district-update/:did").patch(protect, updateDistrict);

module.exports = districtRoutes;
