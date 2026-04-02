const express = require("express");

const {
  createLedgerCollection,
} = require("../../controllers/ledgerCollection/createLedgerCollection");

const {
  paginatedLedgerCollectionList,
} = require("../../controllers/ledgerCollection/paginatedLedgerCollectionList");

const {
  detailLedgerCollection,
} = require("../../controllers/ledgerCollection/detailLedgerCollection");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  generateLedgerCollectionReport,
} = require("../../controllers/ledgerCollection/ledgerCollectionReport");

const ledgerCollectionRoutes = express.Router();

ledgerCollectionRoutes.post(
  "/create_ledger_collection",
  protectDisRoute,
  createLedgerCollection
);

ledgerCollectionRoutes.get(
  "/paginated_ledger_collection_list",
  protect,
  paginatedLedgerCollectionList
);

ledgerCollectionRoutes.get(
  "/detail_ledger_collection/:id",
  protect,
  detailLedgerCollection
);
ledgerCollectionRoutes.get(
  "/ledger-collection-report",
  protect,
  generateLedgerCollectionReport
);
ledgerCollectionRoutes.get(
  "/ledger-collection-export",
  protect,
  generateLedgerCollectionReport
);

module.exports = ledgerCollectionRoutes;
