const express = require("express");
const {
  paginatedRetailerOutletTransaction,
} = require("../../controllers/outletRetailerTransaction/paginatedRetailerOutletTransaction.js");

const {
  bulkOpeningBalanceUpload,
} = require("../../controllers/outletRetailerTransaction/saveCVSOpeningBalance.js");

const {bulkManualPointsUpload} = require("../../controllers/outletRetailerTransaction/bulkManualPoints.js");
const { rebuildRetailerOutletBalance } = require("../../controllers/outletRetailerTransaction/balanceSyncing.js");
const { rebuildRetailerOutletBalanceFromTransactions } = require("../../controllers/outletRetailerTransaction/BulkbalanceSyncing.js");
const { removeRetailerOutletTransactionById } = require("../../controllers/outletRetailerTransaction/removeById.js");
const { allRetailerOutletTransactionReport } = require("../../controllers/outletRetailerTransaction/allRetailerOutletTransactionReport.js");
const { downloadRetailerLedgerReport } = require("../../controllers/outletRetailerTransaction/DownloadReport.js");

const { authorizeRoles, protectRoute } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const { editOutletTransaction } = require("../../controllers/outletRetailerTransaction/editOutletTransaction.js");
const {deleteTransaction} = require("../../controllers/outletRetailerTransaction/deleteTransaction.js");

// const {
//   deleteOutletRetailerTransaction,
// } = require("../../controllers/outletRetailerTransaction/deleteOutletRetailerTransaction");

const {paginatedTransactionRetailer} = require("../../controllers/outletRetailerTransaction/paginatedListForRetailer.js");
const protectRetailerRoute = require("../../middlewares/ptotectReatilerRoute");
const outletRetailerTransactionRoutes = express.Router();

outletRetailerTransactionRoutes
  .route("/retailer-transaction-paginated")
  .get(protect, paginatedRetailerOutletTransaction);

outletRetailerTransactionRoutes
  .route("/bulk-opening-balance-upload")
  .post(protect, bulkOpeningBalanceUpload);

  // Bulk manual points (validate → commit)
outletRetailerTransactionRoutes.route("/manual-points-bulk-upload")
  .post(protect, bulkManualPointsUpload);

// outletRetailerTransactionRoutes
//   .route("/delete-outlet-retailer-transaction/:id")
//   .delete(protectRoute, authorizeRoles(), deleteOutletRetailerTransaction);

outletRetailerTransactionRoutes
  .route("/paginated-tlist-for-retailer")
  .get(protectRetailerRoute , paginatedTransactionRetailer);

outletRetailerTransactionRoutes
  .route("/rebuild-balance/:retailerId")
  .post(protectRoute, authorizeRoles(), rebuildRetailerOutletBalance);

outletRetailerTransactionRoutes
  .route("/rebuild-all-balances")
  .post(protectRoute, authorizeRoles(), rebuildRetailerOutletBalanceFromTransactions);

outletRetailerTransactionRoutes
  .route("/remove/:id")
  .delete(protect, removeRetailerOutletTransactionById);

outletRetailerTransactionRoutes
  .route("/download-retailer-transaction-data")
  .get(protect, allRetailerOutletTransactionReport);

outletRetailerTransactionRoutes
  .route("/download-retailer-ledger-report")
  .get(protect, downloadRetailerLedgerReport);

outletRetailerTransactionRoutes
  .route("/edit-transaction/:id")
  .patch(protect, editOutletTransaction);

outletRetailerTransactionRoutes
  .route("/delete-transaction/:id")
  .delete(protect, deleteTransaction);





module.exports = outletRetailerTransactionRoutes;
