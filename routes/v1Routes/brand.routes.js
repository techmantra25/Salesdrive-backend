const express = require("express");
const { createBrand } = require("../../controllers/brand/createBrand.js");
const { detailBrand } = require("../../controllers/brand/detailBrand.js");
const { updateBrand } = require("../../controllers/brand/updateBrand.js");
const { brandList } = require("../../controllers/brand/brandList.js");
const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { bulkBrandEntry } = require("../../controllers/brand/bulkBrandEntry.js");

const brandRoutes = express.Router();

brandRoutes.route("/create").post(protectRoute,  authorizeRoles(), createBrand);
brandRoutes.route("/list").get(protect, brandList);
brandRoutes.route("/detail/:brandId").get(protect, detailBrand);
brandRoutes.route("/update/:brandId").patch(protectRoute, authorizeRoles(), updateBrand);
brandRoutes.route("/brand-bulk").post(protectRoute, authorizeRoles(), bulkBrandEntry);

module.exports = brandRoutes;
