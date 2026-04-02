const express = require("express");
const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { createOutlet } = require("../../controllers/outlet/createOutlet.js");
const { outletList } = require("../../controllers/outlet/outletList.js");
const { outletDetail } = require("../../controllers/outlet/outletDetail.js");
const { updateOutlet } = require("../../controllers/outlet/updateOutlet.js");
const {
  allOutletsPaginated,
} = require("../../controllers/outlet/allOutletsPaginated.js");
const {
  bulkApproveRejectOutletTemplate,
} = require("../../controllers/outlet/bulkApproveRejectOutletTemplate.js");
const {
  bulkApproveRejectOutlet,
} = require("../../controllers/outlet/bulkApproveRejectOutlet.js");
const { statusUpdate } = require("../../controllers/outlet/statusUpdate.js");

const {
  outletBulkApproveReject,
} = require("../../controllers/outlet/outletBulkApproveReject.js");
const outletRoutes = express.Router();

outletRoutes.route("/create").post(protectRoute,  authorizeRoles(), createOutlet);
outletRoutes.route("/list").get(protect, outletList); // incorrect
outletRoutes.route("/detail/:outletId").get(protect, outletDetail);
outletRoutes
  .route("/update/:outletId")
  .patch(protectRoute,  authorizeRoles(), updateOutlet); // incorrect
outletRoutes.route("/paginated-outlet-list").get(protect, allOutletsPaginated);
outletRoutes
  .route("/bulk-approve-reject-outlet-template")
  .post(protect, bulkApproveRejectOutletTemplate); // incorrect
outletRoutes.route("/bulk-approve-reject-outlet").post(protect, bulkApproveRejectOutlet); // incorrect
outletRoutes
  .route("/status-update/:outletId")
  .patch(protectRoute,  authorizeRoles(), statusUpdate); // incorrect

outletRoutes
  .route("/outlet-approve-reject")
  .post(protectRoute,  authorizeRoles(), outletBulkApproveReject);

module.exports = outletRoutes;
