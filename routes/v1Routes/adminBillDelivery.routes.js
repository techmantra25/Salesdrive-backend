const express = require("express");
const router = express.Router();
const { protectRoute } = require("../../middlewares/protectRoute");
const {
  setBillDeliverySetting,
  getBillDeliverySetting,
  getAllBillDeliverySettings,
  setBillDeliverySettingForAll,
  deleteBillDeliverySetting,
  unlockDistributorPortal,
  getLockedDistributors,
} = require("../../controllers/billDelivery/adminBillDeliverySettings");

// ============ ADMIN ROUTES FOR BILL DELIVERY SETTINGS ============

// Create or update bill delivery setting for a distributor
router.post("/bill-delivery-settings", protectRoute, setBillDeliverySetting);

// Bulk create or update bill delivery setting for all distributors
router.post(
  "/bill-delivery-settings/bulk",
  protectRoute,
  setBillDeliverySettingForAll,
);

// Get all bill delivery settings
router.get("/bill-delivery-settings", protectRoute, getAllBillDeliverySettings);

// Get bill delivery setting for a specific distributor
router.get(
  "/bill-delivery-settings/:distributorId",
  protectRoute,
  getBillDeliverySetting,
);

// Delete bill delivery setting
router.delete(
  "/bill-delivery-settings/:distributorId",
  protectRoute,
  deleteBillDeliverySetting,
);

// Manually unlock distributor portal
router.post(
  "/unlock-distributor-portal",
  protectRoute,
  unlockDistributorPortal,
);

// Get all distributors with locked portals
router.get("/locked-distributors", protectRoute, getLockedDistributors);

module.exports = router;
