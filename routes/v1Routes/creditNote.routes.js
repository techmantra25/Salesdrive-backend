const express = require("express");

const {
  detailCreditNote,
} = require("../../controllers/creditNote/detailCreditNote");

const {
  paginatedCreditNoteList,
} = require("../../controllers/creditNote/paginatedCreditNoteList");
const {
  createManualCreditNote,
} = require("../../controllers/creditNote/createManualCreditNote");

const {
  paginatedCreditNoteReport,
} = require("../../controllers/creditNote/paginatedCreditNoteReport");

const {
  creditNotePrintPDF,
} = require("../../controllers/creditNote/creditNotePrintPDF");

const {
  toggleCreditNoteStatus,
} = require("../../controllers/creditNote/toggleCreditNoteStatus");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const creditNoteRoutes = express.Router();

creditNoteRoutes.route("/detail/:creditNoteId").get(protect, detailCreditNote);

creditNoteRoutes
  .route("/create-credit-note")
  .post(protectDisRoute, createManualCreditNote);

creditNoteRoutes
  .route("/paginated-credit-note-list")
  .get(protect, paginatedCreditNoteList);

creditNoteRoutes
  .route("/paginated-credit-note-report")
  .get(protect, paginatedCreditNoteReport);

creditNoteRoutes
  .route("/credit-note-print/:creditNoteId")
  .get(protect, creditNotePrintPDF);

creditNoteRoutes
  .route("/toggle-status/:creditNoteId")
  .patch(protect, toggleCreditNoteStatus);

module.exports = creditNoteRoutes;
