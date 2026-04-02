const express = require("express");
const {
  paginatedRetailerTransaction,
} = require("../../controllers/retailerMultiplierTransaction/paginatedRetailerTransaction");
const {
  retryRetailerTransaction,
} = require("../../controllers/retailerMultiplierTransaction/retryRetailerTransaction");
const {
  ProcessRetailerMultiplierTransaction,
} = require("../../controllers/retailerMultiplierTransaction/ProcessRetailerMultiplierTransaction");
const {
  retailerRewardLedger,
} = require("../../controllers/retailerMultiplierTransaction/retailerRewardLedger");
const {
  allRetailerMultiplierTransactionReport,
} = require("../../controllers/retailerMultiplierTransaction/allRetailerMultiplierTransactionReport");

const
  deleteRetailerMultiplierTransaction
 = require("../../controllers/retailerMultiplierTransaction/deleteRetailerMultiplierTransaction");

const {
  printMissingRetailerMultiplierTxnCount,
} = require("../../controllers/RBP-controller/retailerMultiplier/missingtransactions");

const {
  downloadRetailerMultiplierCSV,
} = require("../../controllers/RBP-controller/retailerMultiplier/downloadRetailerMultiplierCSV");

const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const retailerTransactionRoutes = express.Router();

retailerTransactionRoutes
  .route("/paginated-retailer-transaction")
  .get(protect, paginatedRetailerTransaction);

retailerTransactionRoutes
  .route("/retry-retailer-transaction")
  .get(protect, retryRetailerTransaction);

retailerTransactionRoutes
  .route("/process-retailer-multiplier-transaction")
  .post(ProcessRetailerMultiplierTransaction);

retailerTransactionRoutes
  .route("/retailer-reward-ledger")
  .get(protect, retailerRewardLedger);

retailerTransactionRoutes
  .route("/retailer-transaction-report")
  .get(protect, allRetailerMultiplierTransactionReport);

retailerTransactionRoutes
  .route("/delete-retailer-multiplier-transaction/:id")
  .delete(protectRoute, authorizeRoles(), deleteRetailerMultiplierTransaction);

retailerTransactionRoutes
  .route("/missing-retailer-multiplier-txn-count")
  .get(protect, printMissingRetailerMultiplierTxnCount);

retailerTransactionRoutes
  .route("/download-retailer-multiplier-csv")
  .get(protect, downloadRetailerMultiplierCSV);

module.exports = retailerTransactionRoutes;
