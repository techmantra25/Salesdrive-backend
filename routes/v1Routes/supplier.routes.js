const express = require("express");

const {
  createSupplier,
} = require("../../controllers/supplier/createSupplier.js");

const {
  detailSupplier,
} = require("../../controllers/supplier/detailSupplier.js");

const {
  updateSupplier,
} = require("../../controllers/supplier/updateSupplier.js");

const {
  paginatedListOfSupplier,
} = require("../../controllers/supplier/paginatedListOfSupplier.js");

const {
  supplierBulkUpload,
} = require("../../controllers/supplier/bulkUploadSupplier.js");

const { protectRoute,authorizeRoles } = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const supplierRoutes = express.Router();

supplierRoutes
  .route("/create-supplier")
  .post(protectRoute, authorizeRoles(), createSupplier);

supplierRoutes.route("/detail-supplier/:sid").get(protect, detailSupplier);

supplierRoutes
  .route("/update-supplier/:sid")
  .patch(protectRoute, authorizeRoles(), updateSupplier);

supplierRoutes.route("/paginated-list-supplier").get(protect, paginatedListOfSupplier);

supplierRoutes.route("/bulk-upload-supplier").post(protect, supplierBulkUpload);

module.exports = supplierRoutes;
