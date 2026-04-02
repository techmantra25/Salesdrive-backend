const Distributor = require("../models/distributor.model");
const Bill = require("../models/bill.model");
const BillDeliverySetting = require("../models/billDeliverySetting.model");
const moment = require("moment-timezone");

const checkAndUpdatePortalLock = async (distributorId) => {
  try {
    // Get distributor
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      console.log(`Distributor ${distributorId} not found`);
      return;
    }

    // Get delivery setting for this distributor
    const deliverySetting = await BillDeliverySetting.findOne({
      distributorId,
    });

    // If no settings found OR settings are inactive, ensure portal is unlocked
    if (!deliverySetting || !deliverySetting.isActive) {
      if (distributor.isPortalLocked) {
        distributor.isPortalLocked = false;
        distributor.portalLockReason = deliverySetting
          ? "Bill delivery configuration is disabled"
          : null;
        distributor.portalLockedAt = null;
        distributor.portalLockedBy = null;
        distributor.pendingBillDeliveries = [];
        await distributor.save();
        console.log(
          `✅ Portal unlocked for ${distributor.name} (${
            deliverySetting
              ? "Configuration is disabled"
              : "No delivery settings"
          })`,
        );
      }
      return;
    }

    // Find all pending bills for this distributor
    const pendingBills = await Bill.find({
      distributorId,
      status: { $in: ["Pending", "Vehicle Allocated", "Partially-Delivered"] },
    })
      .select("billNo invoiceAmount createdAt status")
      .lean();

    if (pendingBills.length === 0) {
      // No pending bills, unlock portal if locked
      if (distributor.isPortalLocked) {
        distributor.isPortalLocked = false;
        distributor.portalLockReason = "All bills have been delivered";
        distributor.portalLockedAt = null;
        distributor.portalLockedBy = null;
        distributor.pendingBillDeliveries = [];
        distributor.lastPortalLockCheck = new Date();
        await distributor.save();
        console.log(
          `✅ Portal automatically unlocked for ${distributor.name} (All bills delivered)`,
        );
      }
      return;
    }

    // Day-based overdue rule in IST: remainingDays === 0 is still deliverable today.
    const nowDay = moment().tz("Asia/Kolkata").startOf("day");
    const overdueBills = [];

    for (const bill of pendingBills) {
      const deliveryDeadline = moment(bill.createdAt)
        .tz("Asia/Kolkata")
        .add(deliverySetting.deliveryDurationDays, "days")
        .startOf("day");

      if (nowDay.isAfter(deliveryDeadline)) {
        overdueBills.push({
          billId: bill._id,
          billNo: bill.billNo,
          createdAt: bill.createdAt,
          deliveryDeadline: deliveryDeadline.endOf("day").toDate(),
          invoiceAmount: bill.invoiceAmount,
        });
      }
    }

    // Lock or unlock based on overdue bills
    if (overdueBills.length > 0) {
      // There are still overdue bills, keep portal locked
      if (!distributor.isPortalLocked) {
        distributor.isPortalLocked = true;
        distributor.portalLockReason = `${overdueBills.length} bill(s) still overdue for delivery`;
        distributor.portalLockedAt = new Date();
        distributor.portalLockedBy = "system";
      }
      distributor.pendingBillDeliveries = overdueBills;
      distributor.lastPortalLockCheck = new Date();
      await distributor.save();
      console.log(
        `🔒 Portal remains locked for ${distributor.name} (${overdueBills.length} overdue bills)`,
      );
    } else {
      // No overdue bills, unlock portal
      if (distributor.isPortalLocked) {
        distributor.isPortalLocked = false;
        distributor.portalLockReason = "All overdue bills have been delivered";
        distributor.portalLockedAt = null;
        distributor.portalLockedBy = null;
        distributor.pendingBillDeliveries = [];
        distributor.lastPortalLockCheck = new Date();
        await distributor.save();
        console.log(
          `✅ Portal automatically unlocked for ${distributor.name} (No overdue bills)`,
        );
      }
    }
  } catch (error) {
    console.error(
      `Error in checkAndUpdatePortalLock for distributor ${distributorId}:`,
      error.message,
    );
  }
};

module.exports = { checkAndUpdatePortalLock };
