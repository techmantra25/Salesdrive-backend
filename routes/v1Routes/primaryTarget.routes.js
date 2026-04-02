const express = require("express");
const { protectRoute } = require("../../middlewares/protectRoute.js");
const { createPrimaryTarget } = require("../../controllers/primaryTarget/createPrimaryTarget.js");
const { allPrimaryTargets } = require("../../controllers/primaryTarget/allPrimaryTargets.js");
const {
  updatePrimaryTarget,
  deletePrimaryTarget,
} = require("../../controllers/primaryTarget/updatePrimaryTarget.js");

const { primaryTargetAllListPaginated } = require("../../controllers/primaryTarget/primaryTargetAllListPaginated.js");
const {primaryTargetDistWisePaginated} = require("../../controllers/primaryTarget/primaryTargetDistWisePaginated.js");
const { updateStatusPrimaryTarget } = require("../../controllers/primaryTarget/updateStatusPrimaryTarget.js");
const { bulkUploadPrimaryTargets } = require("../../controllers/primaryTarget/bulkUploadPrimaryTargets.js");
const {createPrimarySlab}=require("../../controllers/primaryTarget/createPrimarySlab.js");
const {getActivePrimarySlabs}=require("../../controllers/primaryTarget/getActivePrimarySlabs.js");
const {updatePrimaryTargetSlab}=require("../../controllers/primaryTarget/updatePrimaryTargetSlab.js");
const {deletePrimaryTargetSlab}=require("../../controllers/primaryTarget/updatePrimaryTargetSlab.js");
const {protectDisRoute} = require("../../middlewares/protectDisRoute.js");



const primaryTargetRoutes = express.Router();

primaryTargetRoutes.post("/create", protectRoute, createPrimaryTarget);
primaryTargetRoutes.post("/create-bulk", protectRoute, bulkUploadPrimaryTargets);

primaryTargetRoutes.get("/list", allPrimaryTargets);
primaryTargetRoutes.get("/primary-target-list-paginated", primaryTargetAllListPaginated);
primaryTargetRoutes.get(
  "/dist-wise-primary-target-list-paginated",
  protectDisRoute,
  primaryTargetDistWisePaginated
);


primaryTargetRoutes.patch("/update-status/:id", protectRoute, updateStatusPrimaryTarget);

primaryTargetRoutes.route("/create-primary-slab").post(protectRoute, createPrimarySlab);
primaryTargetRoutes.route("/active-primary-slabs").get(getActivePrimarySlabs);
primaryTargetRoutes.patch("/edit-delete-primary-slabs/:id",protectRoute,updatePrimaryTargetSlab);
primaryTargetRoutes.delete("/edit-delete-primary-slabs/:id",protectRoute,deletePrimaryTargetSlab);



primaryTargetRoutes
  .route("/edit--delete-primary-target/:id")
  .patch(protectRoute, updatePrimaryTarget)
  .delete(protectRoute, deletePrimaryTarget);


module.exports = primaryTargetRoutes;
