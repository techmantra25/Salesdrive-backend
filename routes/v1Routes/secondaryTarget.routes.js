const express = require("express");
const { protectRoute } = require("../../middlewares/protectRoute");
const {
  createSecondaryTarget,
} = require("../../controllers/secondaryTarget/createSecondaryTarget");
const {
  secondaryTargetPaginated,
} = require("../../controllers/secondaryTarget/secondaryTargetPaginated");
const {
  bulkUploadSecondaryTargets,
} = require("../../controllers/secondaryTarget/bulkUploadSecondaryTargets");
const {
  editSecondaryTarget,
} = require("../../controllers/secondaryTarget/editSecondaryTarget");
const {
  deleteSecondaryTarget,
} = require("../../controllers/secondaryTarget/deleteSecondaryTarget");
const {
  createSlab,
  editSlab,
  deleteSlab,
} = require("../../controllers/secondaryTarget/createSlab");
const {
  getActiveSlabs,
} = require("../../controllers/secondaryTarget/getActiveSlabs");

const {
  bulkUploadSecondaryTargetsWithDbCode,
} = require("../../controllers/secondaryTarget/bulkUploadSecondaryTargetsWithDbCode");

const {
  secondaryTargetReportDownload,
} = require("../../controllers/secondaryTarget/secondaryTargetReportDownload");

const {secondaryTargetDropdown}= require("../../controllers/secondaryTarget/secondaryTargetDropdown")

const secondaryTargetRoutes = express.Router();

secondaryTargetRoutes
  .route("/create")
  .post(protectRoute, createSecondaryTarget);
secondaryTargetRoutes.route("/create-slab").post(protectRoute, createSlab);
secondaryTargetRoutes
  .route("/bulk-upload/:distributorId")
  .post(protectRoute, bulkUploadSecondaryTargets);
secondaryTargetRoutes.route("/paginated-list").get(secondaryTargetPaginated);
secondaryTargetRoutes.route("/paginated-slab-list").get(getActiveSlabs);

secondaryTargetRoutes.route("/edit/:id").patch(editSecondaryTarget);

secondaryTargetRoutes.route("/edit-slab/:id").patch(protectRoute, editSlab);
secondaryTargetRoutes
  .route("/delete-slab/:id")
  .delete(protectRoute, deleteSlab);

secondaryTargetRoutes
  .route("/secondary-target-report")
  .get(secondaryTargetReportDownload);

secondaryTargetRoutes
  .route("/delete-secondary-target/:id")
  .delete(deleteSecondaryTarget);

secondaryTargetRoutes
  .route("/bulk-upload-with-db-code")
  .post(protectRoute, bulkUploadSecondaryTargetsWithDbCode);

// secondary target dropdown

secondaryTargetRoutes
  .route("/secondary-target-dropdown")
  .get(secondaryTargetDropdown);

module.exports = secondaryTargetRoutes;
