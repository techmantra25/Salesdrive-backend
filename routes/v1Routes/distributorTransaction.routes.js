const express = require("express");
const {
  paginatedDistributorTransaction,
} = require("../../controllers/distributorTransaction/paginatedDistributorTransaction");
const {
  retryDistributorTransaction,
} = require("../../controllers/distributorTransaction/retryDistributorTransaction");
const {
  bulkRetryDistributorTransactions,
} = require("../../controllers/distributorTransaction/bulkRetryDistributorTransaction");
const { retrySingleSalesTransaction } = require("../../controllers/distributorTransaction/retrySingleSalesTransaction");
const {cronRetryAllFailedRbpTransactions}=require("../../controllers/distributorTransaction/cronRetryAllFailedRbpTransactions")
const {
  fixDistributorTransaction,
} = require("../../controllers/distributorTransaction/fixDistributorTransaction");
const { isAdmin, protectRoute } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const {
  createDistributorTransaction,
} = require("../../controllers/distributorTransaction/createDistributorTransaction");
const {
  dbTransactionReport,
} = require("../../controllers/distributorTransaction/dbTransactionReport");
const {
  allTransactionReport,
} = require("../../controllers/distributorTransaction/AllDBTransactionReport");
const {
  gstInputOutputReport,
} = require("../../controllers/Reports/gstInputOutputReport");
const {
  RBPreportForDistributor,
} = require("../../controllers/distributorTransaction/RBPreportForDistributor");
const {
  rebuildDistributorBalance,
} = require("../../controllers/distributorTransaction/rebuildDistributorBalance");
const salesHistoryByRetailer = require("../../controllers/distributorTransaction/SalesHistoryByRetailer");
const {
  deleteDistributorTransaction,
} = require("../../controllers/distributorTransaction/deletetrsaction");

const {
  dbTransactionStockLedgerReport,
} = require("../../controllers/distributorTransaction/AllDBTransactionStockLedgerReport");
const {
  usageReport,
} = require("../../controllers/Reports/usegesReport");


const {fixStockLedger} = require("../../controllers/distributorTransaction/fixStockLedger")
const distributorTransactionRoutes = express.Router();

distributorTransactionRoutes
  .route("/paginated-distributor-transaction")
  .get(protect, paginatedDistributorTransaction);

distributorTransactionRoutes
  .route("/retry-distributor-transaction")
  .get(protect, retryDistributorTransaction);

distributorTransactionRoutes
  .route("/bulk-retry-distributor-transactions")
  .get(protect, bulkRetryDistributorTransactions);


distributorTransactionRoutes
  .route("/single-retry-distributor-transaction")
  .get(protect, retrySingleSalesTransaction);

 distributorTransactionRoutes.route("/cron-all-retry-distributor-transaction")
 .get(cronRetryAllFailedRbpTransactions)

distributorTransactionRoutes
  .route("/fix-distributor-transaction")
  .post(protectRoute, isAdmin, fixDistributorTransaction);

distributorTransactionRoutes
  .route("/create-distributor-transaction")
  .post(protectRoute, isAdmin, createDistributorTransaction);

distributorTransactionRoutes.route("/download-report").get(protect, dbTransactionReport);
distributorTransactionRoutes
  .route("/download-distributor-report")
  .get(protect, RBPreportForDistributor);
distributorTransactionRoutes
  .route("/all-transactions-report")
  .get(protect, allTransactionReport);

distributorTransactionRoutes
  .route("/download-gst-input-output-report")
  .get(protect, gstInputOutputReport);

distributorTransactionRoutes
  .route("/rebuild-distributor-balance/:distributorId")
  .get(protect, rebuildDistributorBalance);

distributorTransactionRoutes
  .route("/sales-history-by-retailer")
  .post(protectDisRoute, salesHistoryByRetailer);

module.exports = distributorTransactionRoutes
  .route("/transaction-stock-ledger-report")
  .get(protect, dbTransactionStockLedgerReport);

distributorTransactionRoutes
  .route("/delete-distributor-transaction/:id")
  .delete(protectRoute, isAdmin, deleteDistributorTransaction);

distributorTransactionRoutes.route("/stock-ledger-fix").post(protectRoute,fixStockLedger);


  distributorTransactionRoutes
  .route("/distributor-usage-report")
  .post(protect, usageReport);
module.exports = distributorTransactionRoutes;
