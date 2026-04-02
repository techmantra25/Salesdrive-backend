const express = require("express");
const {
  fetchSapSecondaryOrderEntryData,
} = require("../../controllers/external/fetchSapSecondaryOrderEntryData");
const {
  paginatedSecondaryOrderEntryDataImportLog,
} = require("../../controllers/external/paginatedSecondaryOrderEntryDataImportLog");

const {
  fetchSapGrnData,
} = require("../../controllers/external/fettchSapGrnData");
const {
  paginatedSapGrnDataImportLog,
} = require("../../controllers/external/paginatedSapGrnDataImportLog");
const {
  syncProductMaster,
} = require("../../controllers/external/syncProductMaster");
const { fetchOutlet } = require("../../controllers/external/fetchOutlet");
const {
  syncPriceMaster,
} = require("../../controllers/external/syncPriceMaster");
const {
  fetchQuotationStatus,
} = require("../../controllers/external/fetchQuotationStatus");
const {
  secondaryOrderEntryLogReport,
} = require("../../controllers/external/secondaryOrderEntryLogReport");
const {
  fetchRetailerCurrentPointBalance,
} = require("../../controllers/external/fetchRetailerCurrentPointBalance");

const {
  syncRegionalProductPrice,
} = require("../../controllers/external/syncRegionalProductPrice");
const {
  deleteGrnLog,
} = require("../../controllers/external/deleteGrnLog");
const {
  syncOutletCodeUpdates,
} = require("../../controllers/external/syncOutletCodeUpdates");
const { protectRoute, authorizeRoles } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const externalRoutes = express.Router();

externalRoutes.get(
  "/fetch-sap-secondary-order-entry-data",
  fetchSapSecondaryOrderEntryData
);
externalRoutes.get(
  "/secondary-order-entry-data-import-log-paginated",
  protect,
  paginatedSecondaryOrderEntryDataImportLog
);
externalRoutes.get(
  "/secondary-order-entry-log-report",
  protect,
  secondaryOrderEntryLogReport
);

externalRoutes.get("/fetch-sap-grn-data", fetchSapGrnData);
externalRoutes.get(
  "/fetch-sap-grn-data-import-log-paginated",
  protect,
  paginatedSapGrnDataImportLog
);

externalRoutes.get("/sync-product-master", syncProductMaster);
externalRoutes.get("/fetch-outlets", fetchOutlet);
externalRoutes.get(
  "/fetch-all-outlets-current-balance",
  fetchRetailerCurrentPointBalance
);

externalRoutes.get("/sync-price-master", syncPriceMaster);
externalRoutes.get("/sync-outlet-code-updates", syncOutletCodeUpdates);
externalRoutes.get("/sync-regional-price", protect, syncRegionalProductPrice);

externalRoutes.post("/fetch-quotation-status", protect, fetchQuotationStatus);

externalRoutes
  .route("/delete-grn-log/:id")
  .delete(protectRoute, authorizeRoles(), deleteGrnLog);

module.exports = externalRoutes;
