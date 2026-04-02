const express = require("express");
const {
  createCollection,
  collectionDetail,
  updateCollection,
  coziCollectionList,
  coziCollectionAllList,
} = require("../../controllers/collection.controller");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const collectionRoutes = express.Router();

collectionRoutes.route("/create").post(protectRoute, isAdmin, createCollection);
collectionRoutes.route("/list").get(protect, coziCollectionAllList);
collectionRoutes.route("/detail/:colId").get(protect, collectionDetail);
collectionRoutes.route("/list-by-catId/:catId").get(protect, coziCollectionList);
collectionRoutes
  .route("/update/:colId")
  .patch(protectRoute, isAdmin, updateCollection);

module.exports = collectionRoutes;
