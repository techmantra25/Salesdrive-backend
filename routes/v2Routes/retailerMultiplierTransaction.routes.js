const express = require("express");
const {
  ProcessRetailerMultiplierTransaction,
} = require("../../controllers/RBP-controller/retailerMultiplier/ProcessRetailerMultiplierTransaction");
const updateRetailerMultiplierTransaction = require("../../controllers/RBP-controller/retailerMultiplier/singleSync");
const bulkSyncRetailerMultiplierTransactions = require("../../controllers/RBP-controller/retailerMultiplier/bulkSync");
const {
  paginatedRetailerTransactionMultipier,
} = require("../../controllers/RBP-controller/retailerMultiplier/paginatedRetailerTransactionMultipier");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  editRetailerMultiplierPoint,
} = require("../../controllers/RBP-controller/retailerMultiplier/editRetailerMultiplierPoint");
const { protectRoute } = require("../../middlewares/protectRoute");

const retailerMultiplierTransactionRoutes = express.Router();

retailerMultiplierTransactionRoutes
  .route("/process-retailer-multiplier-transaction")
  .post(ProcessRetailerMultiplierTransaction);

retailerMultiplierTransactionRoutes
  .route("/update-retailer-multiplier-transaction/:transactionId")
  .put(protect, updateRetailerMultiplierTransaction);

retailerMultiplierTransactionRoutes
  .route("/bulk-sync-retailer-multiplier-transactions")
  .post(protect, bulkSyncRetailerMultiplierTransactions);

retailerMultiplierTransactionRoutes
  .route("/paginated-retailer-transaction")
  .get(protect, paginatedRetailerTransactionMultipier);

retailerMultiplierTransactionRoutes
  .route("/edit-retailer-multiplier-point/:id")
  .put(protectRoute, editRetailerMultiplierPoint);

module.exports = retailerMultiplierTransactionRoutes;
