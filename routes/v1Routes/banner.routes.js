const express = require("express");
const { createBanner } = require("../../controllers/banner/createBanner.js");
const { detailBanner } = require("../../controllers/banner/detailBanner.js");
const { updateBanner } = require("../../controllers/banner/updateBanner.js");
const { bannerList } = require("../../controllers/banner/bannerList.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const bannerRoutes = express.Router();

bannerRoutes.route("/banner-create").post(protect, createBanner);
bannerRoutes.route("/banner-detail/:bannerId").get(protect, detailBanner);
bannerRoutes.route("/banner-update/:bannerId").patch(protect, updateBanner);
bannerRoutes.route("/banner-list").get(bannerList);

module.exports = bannerRoutes;
