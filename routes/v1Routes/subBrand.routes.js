const express = require("express");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  createSubBrand,
} = require("../../controllers/subBrand/createSubBrand.js");
const {
  detailSubBrand,
} = require("../../controllers/subBrand/detailSubBrand.js");
const {
  updateSubBrand,
} = require("../../controllers/subBrand/updateSubBrand.js");
const { subBrandList } = require("../../controllers/subBrand/subBrandList.js");
const { distributorSubBrandList } = require("../../controllers/subBrand/distributorWiseSubBrandList.js");
const {
  bulkSubBrandCreate,
} = require("../../controllers/subBrand/bulkSubBrandCreate.js");

const subBrandRoutes = express.Router();

subBrandRoutes
  .route("/sub-brand-create")
  .post(protectRoute, isAdmin, createSubBrand);
// subBrandRoutes.route("/sub-brand-list").get(subBrandList);
// subBrandRoutes.route("/sub-brand-detail/:subBrandId").get(detailSubBrand);
subBrandRoutes.route("/distributor-subbrand/:distributorId").get(distributorSubBrandList);
subBrandRoutes.route("/sub-brand-list").get(protect, subBrandList);
subBrandRoutes.route("/sub-brand-detail/:subBrandId").get(protect, detailSubBrand);
subBrandRoutes
  .route("/sub-brand-update/:subBrandId")
  .patch(protectRoute, isAdmin, updateSubBrand);

subBrandRoutes
  .route("/bulk-sub-brand-create")
  .post(protectRoute, isAdmin, bulkSubBrandCreate);

module.exports = subBrandRoutes;
