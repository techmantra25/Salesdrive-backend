const express = require("express");
const router = express.Router();
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const {
  getPendingBills,
  getPortalStatus,
  getOverdueBillsCount,
} = require("../../controllers/billDelivery/distributorPendingBills");

// ============ DISTRIBUTOR ROUTES FOR BILL DELIVERY PORTAL ============

// Get pending bills for logged-in distributor
router.get("/pending-bills", protectDisRoute, getPendingBills);

// Get portal lock status for logged-in distributor
router.get("/portal-status", protectDisRoute, getPortalStatus);

// Get overdue bills count
router.get("/overdue-bills-count", protectDisRoute, getOverdueBillsCount);

module.exports = router;
