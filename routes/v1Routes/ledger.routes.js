const express = require("express");
const {
  ledgerPaginatedList,
} = require("../../controllers/ledger/ledgerPaginatedList");
const {
  openingLedgerNotAvailable,
} = require("../../controllers/ledger/openingLedgerNotAvailable");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  BulkOpeningBalanceUpdate,
} = require("../../controllers/ledger/BulkOpeningBalanceUpdate");
const {
  getCurrentLedgerBalance,
} = require("../../controllers/ledger/getCurrentLedgerBalance");
const { ledgerReport } = require("../../controllers/ledger/ledgerReport");

const ledgerRoutes = express.Router();

ledgerRoutes.get("/ledger_paginated_list", protect, ledgerPaginatedList);
ledgerRoutes.get("/ledger_report", protect, ledgerReport);
ledgerRoutes.get(
  "/opening_ledger_not_available",
  protectDisRoute,
  openingLedgerNotAvailable
);
ledgerRoutes.post(
  "/opening_ledger_bulk_update",
  protectDisRoute,
  BulkOpeningBalanceUpdate
);
ledgerRoutes.get(
  "/get_current_balance",
  protectDisRoute,
  getCurrentLedgerBalance
);

module.exports = ledgerRoutes;
