const express = require("express");
const {
  paginatedDistributorTransaction,
} = require("../../controllers/RBP-controller/distributorTransaction/paginatedDistributorTransaction");

const updateDistributorTransaction = require("../../controllers/RBP-controller/distributorTransaction/update");
const { bulkRetryDistributorTransactions } = require("../../controllers/RBP-controller/distributorTransaction/bulkRetryDistributorTransactions")
const bulkSyncRetailerOutletTransactions = require("../../controllers/RBP-controller/distributorTransaction/bulkUpdate");
const {printMissingOutletTxnCount}=require("../../controllers/RBP-controller/distributorTransaction/printMissingOutletTxnCount")
const editDistributorTransaction = require("../../controllers/RBP-controller/distributorTransaction/editDistributorTransection");
const { protect } = require("../../middlewares/auth.middleware.js");

const distributorTransactionRouter = express.Router();

distributorTransactionRouter
  .route("/paginated-distributor-transaction")
  .get(protect, paginatedDistributorTransaction);

distributorTransactionRouter
  .route("/update-distributor-transaction/:transactionId")
  .patch(protect, updateDistributorTransaction);

distributorTransactionRouter
  .route("/edit-distributor-transaction/:transactionId")
  .patch(protect, editDistributorTransaction);


distributorTransactionRouter.route("/bulk-retry-distributor-transactions").get(protect, bulkRetryDistributorTransactions)
distributorTransactionRouter.route("/count-retaielrid").get(protect, printMissingOutletTxnCount)

distributorTransactionRouter
  .route("/bulk-sync-retailer-outlet-transactions")
  .post(protect, bulkSyncRetailerOutletTransactions);

module.exports = distributorTransactionRouter;
