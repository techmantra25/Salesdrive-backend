const express = require("express");
const {
  getConfig,
  upsertConfig,
} = require("../../controllers/config.controller");

// ------------Dynamic Cron imports----------------
const {
  getAutoPendingBillCronConfig,
  updateAutoPendingBillCronConfig,
} = require("../../controllers/jobControl/autoPendingBillCronConfig");
const {
  getPortalLockCheckCronConfig,
  updatePortalLockCheckCronConfig,
} = require("../../controllers/jobControl/portalLockCheckCronConfig");
const {
  getPartiallyDeliveredBillRetryCronConfig,
  updatePartiallyDeliveredBillRetryCronConfig,
} = require("../../controllers/jobControl/partiallyDeliveredBillRetryCronConfig");

// Recalculate balance imports
const {
  rebuildAllDistributorBalances,
} = require("../../controllers/distributorTransaction/rebuildDistributorBalance");
const {
  rebuildAllRetailerBalances,
} = require("../../controllers/outletRetailerTransaction/rebuildAllRetailerBalances");
const {
  fixStockLedgerAllDistributors,
} = require("../../controllers/transction/fixStockLedgerAllDistributors");
const {
  isAdmin,
  protectRoute,
  authorizeRoles,
} = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const configRoutes = express.Router();

// Route to get the configuration
configRoutes.route("/get-config").get(getConfig);
// Route to update the configuration
configRoutes
  .route("/update-config")
  .patch(protectRoute, authorizeRoles(), upsertConfig);

// Route to get/update auto pending bill cron configuration
configRoutes
  .route("/auto-pending-bill-cron")
  .get(protectRoute, authorizeRoles(), getAutoPendingBillCronConfig)
  .patch(protectRoute, authorizeRoles(), updateAutoPendingBillCronConfig);

// Route to get/update portal lock check cron configuration
configRoutes
  .route("/portal-lock-check-cron")
  .get(protectRoute, authorizeRoles(), getPortalLockCheckCronConfig)
  .patch(protectRoute, authorizeRoles(), updatePortalLockCheckCronConfig);

// Route to get/update partially-delivered bill retry cron configuration
configRoutes
  .route("/partially-delivered-bill-retry-cron")
  .get(protectRoute, authorizeRoles(), getPartiallyDeliveredBillRetryCronConfig)
  .patch(
    protectRoute,
    authorizeRoles(),
    updatePartiallyDeliveredBillRetryCronConfig,
  );

// Recalculate balance imports
configRoutes
  .route("/rebuild-distributor-balance")
  .post(protectRoute, isAdmin, rebuildAllDistributorBalances);

configRoutes
  .route("/rebuild-retailer-balance")
  .post(protectRoute, isAdmin, rebuildAllRetailerBalances);

configRoutes
  .route("/fix-stock-ledger-all-distributors")
  .post(protectRoute, isAdmin, fixStockLedgerAllDistributors);

module.exports = configRoutes;
