const express = require("express");
const { protect } = require("../../middlewares/auth.middleware.js");
const retailerMultiplierTransactionShadowRouter = express.Router();
const {
  ProcessRetailerMultiplierTransactionShadow,
  startShadowMultiplierRun,
  resumeShadowMultiplierRun,
  getShadowMultiplierRunStatus,
} = require("../../controllers/RBP-controller/retailerMultiplier/ProcessRetailerMultiplierTransactionShadow.js");

const {
  compareRetailerMultiplierTransactions,
} = require("../../controllers/RBP-controller/retailerMultiplier/compareRetailerMultiplierTransactions");

const {
  fixShadowVsMainMultiplier,
} = require("../../controllers/RBP-controller/retailerMultiplier/fixShadowVsMainMultiplier.js");
// POST route to trigger shadow multiplier transaction
retailerMultiplierTransactionShadowRouter.post(
  "/process-shadow-multiplier",
  ProcessRetailerMultiplierTransactionShadow,
);
retailerMultiplierTransactionShadowRouter.post(
  "/start-shadow-run",
  startShadowMultiplierRun,
);
retailerMultiplierTransactionShadowRouter.post(
  "/resume-shadow-run/:runId",
  resumeShadowMultiplierRun,
);
retailerMultiplierTransactionShadowRouter.get(
  "/shadow-run-status/:runId",
  getShadowMultiplierRunStatus,
);

// Route to compare RetailerMultiplierTransaction and RetailerMultiplierTransactionShadow
retailerMultiplierTransactionShadowRouter
  .route("/compare-retailer-multiplier-transactions")
  .get(compareRetailerMultiplierTransactions);

retailerMultiplierTransactionShadowRouter
  .route("/fix-shadow-main-multiplier")
  .post(protect, fixShadowVsMainMultiplier);

module.exports = retailerMultiplierTransactionShadowRouter;
