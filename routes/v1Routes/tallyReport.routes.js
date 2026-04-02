const express = require("express");
const router = express.Router();
const tallyReportController = require("../../controllers/Tally/tallyTransaction.controller");
const { protect } = require("../../middlewares/auth.middleware.js");

router.post("/generate", protect, tallyReportController.generateTallyReport);
router.get("/summary", protect, tallyReportController.getTallyReportSummary);


router.get(
  "/inventory-transactions",
  protect,
  tallyReportController.getInventoryTransactions,
);

module.exports = router;
