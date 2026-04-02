const express = require("express");
const {
  allTransactionList,
} = require("../../controllers/transction/allTransactionList");

const {
  listbyproduct,
} = require("../../controllers/transction/listbyprosduct");

const {
  closingStockCount,
} = require("../../controllers/transction/closingStockCount");

const {
  transactionlist,
} = require("../../controllers/transction/allTransactionNoList");

const { stockTransfer } = require("../../controllers/transction/stockTransfer");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const protectAdminOrEmployeeRoute = require("../../middlewares/protectAdminOrEmployeeRoute");
const {
  allTransactionListReport,
} = require("../../controllers/transction/allTransactionListReport");
const {
  transactionReport,
} = require("../../controllers/transction/transactionReport");

const {viewAllTransactionReport} = require("../../controllers/transction/viewAllTransactionReport")
const { allTransactionList: adminAllTransactionList } = require("../../controllers/transction/AdminallTransactionList");
const { deleteDistributorTransaction } = require("../../controllers/distributorTransaction/deletetrsaction");
const { deleteTransaction } = require("../../controllers/transction/deleteTransaction");


const { updateTransactionQty } = require("../../controllers/transction/updateTransactionQty");

const transactionRoutes = express.Router();

transactionRoutes.route("/stock-transfer").post(protectDisRoute, stockTransfer);

transactionRoutes.route("/all-list").get(protectDisRoute, allTransactionList);
transactionRoutes.route("/alllist-admins").post(adminAllTransactionList);

transactionRoutes.route("/all-list-report").get(protect, allTransactionListReport);

transactionRoutes
  .route("/list-by-product/:productId/:distributorId")
  .get(protect, listbyproduct);

transactionRoutes.route("/closing-stock-count").get(protect, closingStockCount);

transactionRoutes
  .route("/transaction-no-list")
  .get(protectDisRoute, transactionlist);
transactionRoutes.route("/transaction-csv-report").get(protect, transactionReport);

transactionRoutes.route("/view-all-transaction-report").get(protect, viewAllTransactionReport);
transactionRoutes.route("/delete-distributor-transaction/:id").delete(protectAdminOrEmployeeRoute, deleteDistributorTransaction);

transactionRoutes.route("/delete/:id").delete(protect, deleteTransaction);
transactionRoutes.route("/update-qty/:id").patch(protect, updateTransactionQty)

module.exports = transactionRoutes;
