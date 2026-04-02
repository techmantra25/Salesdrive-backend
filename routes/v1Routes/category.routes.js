const express = require("express");
const {
  createCategory,
  categoryDetail,
  updateCategory,
  categoryList,
} = require("../../controllers/category.controller");
const { protectRoute, isAdmin,authorizeRoles } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const categoryRoutes = express.Router();

categoryRoutes.route("/create").post(protectRoute, authorizeRoles(), createCategory);
categoryRoutes.route("/list").get(protect, categoryList);
categoryRoutes.route("/detail/:catId").get(protect, categoryDetail);
categoryRoutes
  .route("/update/:catId")
  .patch(protectRoute, authorizeRoles(), updateCategory);

module.exports = categoryRoutes;
