const Distributor = require("../models/distributor.model");
const Bill = require("../models/bill.model");
const BillDeliverySetting = require("../models/billDeliverySetting.model");
const moment = require("moment-timezone");

/*** Check and lock distributor portals based on overdue bill deliveries
 * This job runs periodically (e.g., every hour or every 6 hours)*/
const checkAndLockDistributorPortals = async () => {
  try {
    console.log("========================================");
    console.log("Starting Portal Lock Check Job");
    console.log(
      "Time:",
      moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
    );
    console.log("========================================");

    // Get all active bill delivery settings
    const activeSettings = await BillDeliverySetting.find({ isActive: true });

    if (activeSettings.length === 0) {
      console.log("No active bill delivery settings found");
      return;
    }

    console.log(`Found ${activeSettings.length} active settings`);

    let lockedCount = 0;
    let unlockedCount = 0;
    let skippedCount = 0;

    // Process each distributor with active settings
    for (const setting of activeSettings) {
      try {
        const distributorId = setting.distributorId;

        // Get distributor
        const distributor = await Distributor.findById(distributorId);
        if (!distributor) {
          console.log(`Distributor ${distributorId} not found, skipping...`);
          skippedCount++;
          continue;
        }

        // Find all pending bills for this distributor
        const pendingBills = await Bill.find({
          distributorId,
          status: {
            $in: ["Pending", "Vehicle Allocated", "Partially-Delivered"],
          },
        })
          .select("billNo invoiceAmount createdAt status")
          .lean();

        if (pendingBills.length === 0) {
          // No pending bills, unlock portal if locked
          if (distributor.isPortalLocked) {
            distributor.isPortalLocked = false;
            distributor.portalLockReason = null;
            distributor.portalLockedAt = null;
            distributor.portalLockedBy = null;
            distributor.pendingBillDeliveries = [];
            distributor.lastPortalLockCheck = new Date();
            await distributor.save();
            console.log(
              `✅ Portal unlocked for: ${distributor.name} (No pending bills)`,
            );
            unlockedCount++;
          } else {
            skippedCount++;
          }
          continue;
        }

        // Day-based overdue rule in IST: remainingDays === 0 is still deliverable today.
        const nowDay = moment().tz("Asia/Kolkata").startOf("day");
        const overdueBills = [];

        for (const bill of pendingBills) {
          const deliveryDeadline = moment(bill.createdAt)
            .tz("Asia/Kolkata")
            .add(setting.deliveryDurationDays, "days")
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

        // Lock portal if there are overdue bills
        if (overdueBills.length > 0) {
          if (!distributor.isPortalLocked) {
            distributor.isPortalLocked = true;
            distributor.portalLockReason = `${overdueBills.length} bill(s) overdue for delivery. Deadline: ${setting.deliveryDurationDays} days from bill creation.`;
            distributor.portalLockedAt = new Date();
            distributor.portalLockedBy = "system";
            distributor.pendingBillDeliveries = overdueBills;
            distributor.lastPortalLockCheck = new Date();
            await distributor.save();

            console.log(`🔒 Portal locked for: ${distributor.name}`);
            console.log(`   - Overdue bills: ${overdueBills.length}`);
            console.log(`   - Total pending: ${pendingBills.length}`);
            lockedCount++;
          } else {
            // Already locked, just update the pending bills list
            distributor.pendingBillDeliveries = overdueBills;
            distributor.lastPortalLockCheck = new Date();
            await distributor.save();
            console.log(
              `🔒 Portal still locked for: ${distributor.name} (${overdueBills.length} overdue bills)`,
            );
            skippedCount++;
          }
        } else {
          // No overdue bills, unlock portal if locked
          if (distributor.isPortalLocked) {
            distributor.isPortalLocked = false;
            distributor.portalLockReason = null;
            distributor.portalLockedAt = null;
            distributor.portalLockedBy = null;
            distributor.pendingBillDeliveries = [];
            distributor.lastPortalLockCheck = new Date();
            await distributor.save();
            console.log(
              `✅ Portal unlocked for: ${distributor.name} (No overdue bills)`,
            );
            unlockedCount++;
          } else {
            skippedCount++;
          }
        }
      } catch (err) {
        console.error(
          `Error processing distributor ${setting.distributorId}:`,
          err.message,
        );
      }
    }

    console.log("========================================");
    console.log("Portal Lock Check Job Completed");
    console.log(
      `Locked: ${lockedCount}, Unlocked: ${unlockedCount}, Skipped: ${skippedCount}`,
    );
    console.log("========================================");
  } catch (error) {
    console.error("Error in checkAndLockDistributorPortals:", error);
  }
};

module.exports = { checkAndLockDistributorPortals };
