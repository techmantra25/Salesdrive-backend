const express = require("express");
const router = express.Router();
const {
  rebuildAllDistributorBalances,
} = require("../../controllers/distributorTransaction/rebuildDistributorBalance");
const {
  rebuildAllRetailerBalances,
} = require("../../controllers/outletRetailerTransaction/rebuildAllRetailerBalances");

router.post("/rebuild-distributor-balance", rebuildAllDistributorBalances);
router.get("/rebuild-distributor-balance/test", rebuildAllDistributorBalances);

router.post("/rebuild-retailer-balance", rebuildAllRetailerBalances);
router.get("/rebuild-retailer-balance/test", rebuildAllRetailerBalances);

module.exports = router;
