const express = require("express");
const {
  draftCreate,
} = require("../../controllers/transactionDraft/draftCreate");

const {
  detailDraft,
} = require("../../controllers/transactionDraft/detailDraft");

const {
  updateTransactionDraft,
} = require("../../controllers/transactionDraft/updateDraft");

const { allDraftList } = require("../../controllers/transactionDraft/allList");

const {
  deleteDraft,
} = require("../../controllers/transactionDraft/deleteDraft");

const {
  protectDisRoute,
} = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");


const transactionDraftRoutes = express.Router();

transactionDraftRoutes.route("/create").post(protectDisRoute, draftCreate);

transactionDraftRoutes
  .route("/detail/:transactionDraftId")
  .get(protectDisRoute, detailDraft);

transactionDraftRoutes
  .route("/update/:transactionDraftId")
  .patch(protectDisRoute, updateTransactionDraft);

transactionDraftRoutes.route("/all-list").get(protect, allDraftList);

transactionDraftRoutes
  .route("/delete/:transactionDraftId")
  .delete(protectDisRoute, deleteDraft);

module.exports = transactionDraftRoutes;
