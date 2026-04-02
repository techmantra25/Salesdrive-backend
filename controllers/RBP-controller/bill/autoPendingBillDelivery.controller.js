const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const Bill = require("../../../models/bill.model");
const Inventory = require("../../../models/inventory.model");
const Transaction = require("../../../models/transaction.model");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const Ledger = require("../../../models/ledger.model");
const BillDeliverySetting = require("../../../models/billDeliverySetting.model");
const SystemConfig = require("../../../models/systemConfig.model");
const {
  transactionCode,
  retailerOutletTransactionCode,
  ledgerTransactionCode,
} = require("../../../utils/codeGenerator");
const {
  updateSecondaryTargetAchievement,
} = require("../../bill/util/updateSecondaryTargetAchievement");
const { checkAndUpdatePortalLock } = require("../../../utils/checkPortalLock");
const {
  createStockLedgerEntry,
} = require("../../transction/createStockLedgerEntry");
const { calculateBackdateFields } = require("../../../utils/backdateHelper");

let Distributor;
try {
  Distributor = require("../../../models/distributor.model");
} catch {
  Distributor = null;
}

// ============ ERROR CLASS ============
class AdjustmentError extends Error {
  constructor(message, nonRetriable = false) {
    super(message);
    this.nonRetriable = !!nonRetriable;
  }
}

// ============ HELPERS ============
const isNonAdjustableItem = (item) =>
  item.itemBillType === "Item Removed" ||
  item.itemBillType === "Stock out" ||
  Number(item.billQty) <= 0;

const getAdjustableItems = (bill) =>
  bill.lineItems.filter((item) => !isNonAdjustableItem(item));

const isSameDistributor = (bill, userId) =>
  String(bill.distributorId) === String(userId);

const getDistributor = async (id) =>
  (await OutletApproved.findById(id).lean()) ||
  (Distributor ? await Distributor.findById(id).lean() : null);

// ============ LEDGER ENTRIES ============
/**
 * Creates financial ledger entries for a bill
 * All entries are scoped to specific distributor (dbId) and retailer pair
 */
const createLedgerEntries = async (bill, userId, backdateFields) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  // Ensure bill belongs to this distributor
  if (String(bill.distributorId._id || bill.distributorId) !== String(userId)) {
    throw new Error(
      `ISOLATION ERROR: Bill ${finalBillNo} does not belong to distributor ${userId}`,
    );
  }

  // Check if ledger entry already exists
  const exists = await Ledger.exists({
    billId: bill._id,
    dbId: userId,
    transactionFor: "Sales",
  });

  if (exists) {
    console.log(`✓ Ledger entry already exists for bill ${finalBillNo}`);
    return true;
  }

  const creditAmount = Number(bill.creditAmount) || 0;

  // Get last ledger entry for THIS distributor-retailer pair only
  const last = await Ledger.findOne({
    dbId: userId,
    retailerId: bill.retailerId,
  }).sort({ createdAt: -1 });

  let balance = last ? Number(last.balance) : 0;

  const txnId = await ledgerTransactionCode("LEDG", userId);
  balance -= bill.netAmount;

  // Create debit entry for the bill
  const ledgerDebitData = {
    dbId: userId,
    retailerId: bill.retailerId,
    billId: bill._id,
    date: backdateFields.deliveryDate, // Use deliveryDate from backdate logic
    transactionId: txnId,
    transactionType: "debit",
    transactionFor: "Sales",
    transactionAmount: bill.netAmount,
    balance,
  };

  // Explicitly set timestamps for backdate
  if (backdateFields.deliveryDate) {
    ledgerDebitData.createdAt = backdateFields.deliveryDate;
    ledgerDebitData.updatedAt = backdateFields.deliveryDate;
  }

  await Ledger.create(ledgerDebitData);

  console.log(`✓ Ledger debit entry created for bill ${finalBillNo}`);

  // Small delay to ensure sequential creation
  await new Promise((resolve) => setTimeout(resolve, 200));

  // If there's a credit amount, create credit adjustment entry
  if (creditAmount > 0) {
    // Get updated balance for THIS distributor-retailer pair
    const last2 = await Ledger.findOne({
      dbId: userId,
      retailerId: bill.retailerId,
    }).sort({ createdAt: -1 });

    let balance2 = last2 ? Number(last2.balance) : 0;

    const creditTransactionId = await ledgerTransactionCode("LEDG", userId);
    balance2 += creditAmount;

    // Create credit entry
    const ledgerCreditData = {
      dbId: userId,
      retailerId: bill.retailerId,
      billId: bill._id,
      date: backdateFields.deliveryDate, // Use deliveryDate from backdate logic
      transactionId: creditTransactionId,
      transactionType: "credit",
      transactionFor: "Sales-Credit-Adjustment",
      transactionAmount: creditAmount,
      balance: balance2,
    };

    // Explicitly set timestamps for backdate
    if (backdateFields.deliveryDate) {
      ledgerCreditData.createdAt = backdateFields.deliveryDate;
      ledgerCreditData.updatedAt = backdateFields.deliveryDate;
    }

    await Ledger.create(ledgerCreditData);

    console.log(
      `✓ Ledger credit adjustment entry created for bill ${finalBillNo}`,
    );
  }

  return true;
};

// ============ REWARD - DISTRIBUTOR ============
/*** Creates distributor reward transaction*/
const createDistributorRewardTransaction = async (
  bill,
  userId,
  rewardPoints,
  distributor,
  backdateFields,
) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  if (String(bill.distributorId._id || bill.distributorId) !== String(userId)) {
    throw new Error(
      `ISOLATION ERROR: Bill ${finalBillNo} does not belong to distributor ${userId}`,
    );
  }

  // Check if distributor transaction already exists
  const existingDistributorTxn = await DistributorTransaction.findOne({
    billId: bill._id,
    distributorId: userId,
    transactionFor: "SALES",
    status: "Success",
  });

  if (existingDistributorTxn) {
    console.log(
      `✓ Distributor reward already transferred for bill ${finalBillNo}`,
    );
    return existingDistributorTxn;
  }

  // Fetch retailer
  const retailer = await OutletApproved.findById(bill.retailerId).lean();
  if (!retailer?.outletUID) {
    console.log(`⚠ Retailer UID missing for bill ${finalBillNo}`);
    return null;
  }

  // Check distributor balance
  const lastDistributorTxn = await DistributorTransaction.findOne({
    distributorId: userId,
  }).sort({ createdAt: -1 });

  const distributorBalance = lastDistributorTxn
    ? Number(lastDistributorTxn.balance)
    : 0;

  const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor.dbCode}`;

  // Create distributor transaction
  const distributorTransactionData = {
    distributorId: userId,
    billId: bill._id,
    retailerId: bill.retailerId,
    transactionType: "debit",
    transactionFor: "SALES",
    point: rewardPoints,
    balance: distributorBalance - rewardPoints,
    status: "Success",
    remark: remarkText,
    dates: {
      deliveryDate: backdateFields.deliveryDate,
      originalDeliveryDate: backdateFields.originalDeliveryDate,
    },
    enabledBackDate: backdateFields.enabledBackDate,
  };

  // Explicitly set timestamps for backdate
  if (backdateFields.deliveryDate) {
    distributorTransactionData.createdAt = backdateFields.deliveryDate;
    distributorTransactionData.updatedAt = backdateFields.deliveryDate;
  }

  const distributorTransaction = await DistributorTransaction.create(
    distributorTransactionData,
  );

  console.log(
    `✓ Distributor reward transferred for bill ${finalBillNo} → ${rewardPoints} points`,
  );

  return distributorTransaction;
};

// ============ REWARD - RETAILER ============
/*** Creates retailer reward transaction*/
const createRetailerRewardTransaction = async (
  bill,
  userId,
  rewardPoints,
  distributorTransaction,
  distributor,
  backdateFields,
) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  // Ensure bill belongs to this distributor
  if (String(bill.distributorId._id || bill.distributorId) !== String(userId)) {
    throw new Error(
      `ISOLATION ERROR: Bill ${finalBillNo} does not belong to distributor ${userId}`,
    );
  }

  // Check if retailer transaction already exists
  const existingRetailerTxn = await RetailerOutletTransaction.findOne({
    billId: bill._id,
    distributorId: userId,
    transactionFor: "SALES",
    status: "Success",
  });

  if (existingRetailerTxn) {
    console.log(`✓ Retailer reward already credited for bill ${finalBillNo}`);
    return existingRetailerTxn;
  }

  if (!distributorTransaction) {
    throw new Error("Distributor transaction required for retailer reward");
  }

  // Fetch retailer
  const retailer = await OutletApproved.findById(bill.retailerId).lean();
  if (!retailer?.outletUID) {
    console.log(`⚠ Retailer UID missing for bill ${finalBillNo}`);
    return null;
  }

  // Use passed distributor or fetch it
  const dist = distributor || (await getDistributor(userId));
  const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${
    retailer.outletUID
  } and DB Code ${dist?.dbCode || "N/A"}`;

  // Get retailer balance
  const lastRetailerTxn = await RetailerOutletTransaction.findOne({
    retailerId: bill.retailerId,
  }).sort({ createdAt: -1 });

  const retailerBalance = lastRetailerTxn
    ? Number(lastRetailerTxn.balance)
    : Number(retailer.currentPointBalance) || 0;

  // Create retailer transaction
  const retailerTransactionData = {
    retailerId: bill.retailerId,
    distributorId: userId,
    billId: bill._id,
    transactionId: await retailerOutletTransactionCode("RTO"),
    distributorTransactionId: distributorTransaction._id,
    transactionType: "credit",
    transactionFor: "SALES",
    point: rewardPoints,
    balance: retailerBalance + rewardPoints,
    status: "Success",
    remark: remarkText,
    dates: {
      deliveryDate: backdateFields.deliveryDate,
      originalDeliveryDate: backdateFields.originalDeliveryDate,
    },
    enabledBackDate: backdateFields.enabledBackDate,
  };

  // Explicitly set timestamps for backdate
  if (backdateFields.deliveryDate) {
    retailerTransactionData.createdAt = backdateFields.deliveryDate;
    retailerTransactionData.updatedAt = backdateFields.deliveryDate;
  }

  const retailerOutletTransaction = await RetailerOutletTransaction.create(
    retailerTransactionData,
  );

  // Link back to distributor transaction
  await DistributorTransaction.updateOne(
    { _id: distributorTransaction._id, distributorId: userId },
    {
      $set: {
        retailerOutletTransactionId: retailerOutletTransaction._id,
      },
    },
  );

  // Update retailer's point balance snapshot
  await OutletApproved.updateOne(
    { _id: bill.retailerId },
    { $inc: { currentPointBalance: rewardPoints } },
  );

  console.log(
    `✓ Retailer reward credited for bill ${finalBillNo} → ${rewardPoints} points`,
  );

  return retailerOutletTransaction;
};

// ============ COMBINED REWARD ============

const createSalesRewardPoints = async (bill, userId) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  // Fetch distributor to check RBP mapping
  const distributor = await getDistributor(userId);
  if (!distributor || distributor.RBPSchemeMapped !== "yes") {
    console.log(
      `⚠ RBP not mapped for distributor ${userId} - skipping reward transfer for bill ${finalBillNo}`,
    );
    return { distributorTxn: null, retailerTxn: null, skipped: true };
  }

  // Fetch retailer - REQUIRED for reward transactions
  const retailer = await OutletApproved.findById(bill.retailerId).lean();
  if (!retailer || !retailer.outletUID) {
    console.log(`⚠ Retailer UID missing for bill ${finalBillNo}`);
    return { distributorTxn: null, retailerTxn: null, skipped: true };
  }

  // Calculate reward points from delivered items
  let rewardPoints = 0;
  for (const item of bill.lineItems) {
    if (isNonAdjustableItem(item)) continue;

    const delivered = await Transaction.exists({
      billId: bill._id,
      billLineItemId: item._id,
      transactionType: "delivery",
      type: "Out",
    });

    if (!delivered) continue;

    const basePoint = Number(
      item.usedBasePoint ?? item.product?.base_point ?? 0,
    );
    rewardPoints += basePoint * Number(item.billQty || 0);
  }

  // Use total base points if calculated is different
  if (rewardPoints !== bill.totalBasePoints) {
    rewardPoints = bill.totalBasePoints;
  }

  if (rewardPoints <= 0) {
    console.log(`⚠ No reward points to transfer for bill ${finalBillNo}`);
    return { distributorTxn: null, retailerTxn: null, skipped: true };
  }

  // Step 1: Create distributor reward transaction
  const distributorTxn = await createDistributorRewardTransaction(
    bill,
    userId,
    rewardPoints,
    distributor,
    bill.backdateFields || {
      deliveryDate: bill.dates?.deliveryDate || new Date(),
      originalDeliveryDate: bill.dates?.originalDeliveryDate || new Date(),
      enabledBackDate: bill.enabledBackDate || false,
    },
  );

  if (!distributorTxn) {
    throw new Error("Failed to create distributor reward transaction");
  }

  // Step 2: Create retailer reward transaction
  const retailerTxn = await createRetailerRewardTransaction(
    bill,
    userId,
    rewardPoints,
    distributorTxn,
    distributor,
    bill.backdateFields || {
      deliveryDate: bill.dates?.deliveryDate || new Date(),
      originalDeliveryDate: bill.dates?.originalDeliveryDate || new Date(),
      enabledBackDate: bill.enabledBackDate || false,
    },
  );

  if (!retailerTxn) {
    throw new Error("Failed to create retailer reward transaction");
  }

  return { distributorTxn, retailerTxn };
};

const autoPendingBillDelivery = asyncHandler(async (req, res) => {
  console.log(`\n========== AUTO PENDING BILL DELIVERY STARTED ==========`);
  console.log(`Execution time: ${new Date().toISOString()}`);

  let results = {
    success: 0,
    failed: 0,
    skipped: 0,
    totalProcessed: 0,
    bills: [],
    errors: [],
  };

  try {
    // ============ FETCH CRON CONFIGURATION ============
    // Fetch the auto-pending-bill cron configuration to get when backdate restriction started
    const autoPendingBillConfig = await SystemConfig.findOne({
      job: "autoPendingBillDelivery",
    });
    const autoPendingBillCronSetAt = autoPendingBillConfig?.createdAt || null;

    if (autoPendingBillCronSetAt) {
      console.log(
        `[CONFIG] Auto-pending-bill cron configured since: ${moment(autoPendingBillCronSetAt).format("YYYY-MM-DD HH:mm:ss")}`,
      );
    } else {
      console.log(
        `[CONFIG] Auto-pending-bill cron configuration not found - will process all eligible bills`,
      );
    }

    // Calculate the date range for the PREVIOUS month
    const now = moment.tz("Asia/Kolkata");
    const dayOfMonth = now.date();
    const previousMonthStart = now
      .clone()
      .subtract(1, "month")
      .startOf("month");
    const previousMonthEnd = now.clone().subtract(1, "month").endOf("month");

    console.log(
      `Previous month range: ${previousMonthStart.format("YYYY-MM-DD")} to ${previousMonthEnd.format("YYYY-MM-DD")}`,
    );

    // Run this cron processing only from 1st to 4th of the month
    if (dayOfMonth > 4) {
      console.log(
        `Today is ${dayOfMonth}. Auto pending bill delivery runs only on 1st-4th, skipping execution.`,
      );

      if (res) {
        return res.json({
          error: false,
          message:
            "Auto pending bill delivery skipped - allowed run window is 1st to 4th",
          results,
        });
      }

      return results;
    }

    // Day-wise batch logic:
    // 1st-3rd: process max 100 previous-month pending bills per day
    // 4th: process all remaining previous-month pending bills
    const batchLimit = dayOfMonth <= 3 ? 100 : null;

    console.log(
      batchLimit
        ? `Batch mode active for day ${dayOfMonth}: processing up to ${batchLimit} bills`
        : `Final catch-up mode for day ${dayOfMonth}: processing all remaining bills`,
    );

    // Find all pending/partially-delivered bills created in the previous month
    // Only include bills created AFTER the cron config was set up (if config exists)
    const pendingFilter = {
      status: { $in: ["Pending", "Partially-Delivered"] },
      createdAt: {
        $gte: previousMonthStart.toDate(),
        $lte: previousMonthEnd.toDate(),
      },
    };

    // If cron config exists, only process bills created after its configuration date
    if (autoPendingBillCronSetAt) {
      pendingFilter.createdAt.$gte = new Date(
        Math.max(
          previousMonthStart.toDate().getTime(),
          autoPendingBillCronSetAt.getTime(),
        ),
      );

      console.log(
        `[FILTER] Only processing bills created after config date: ${moment(autoPendingBillCronSetAt).format("YYYY-MM-DD HH:mm:ss")}`,
      );
    }

    const totalPendingBills = await Bill.countDocuments(pendingFilter);

    let pendingBillsQuery = Bill.find(pendingFilter).sort({
      createdAt: 1,
      _id: 1,
    });

    if (batchLimit) {
      pendingBillsQuery = pendingBillsQuery.limit(batchLimit);
    }

    const pendingBills = await pendingBillsQuery.populate(
      "lineItems.product lineItems.inventoryId distributorId retailerId",
    );

    console.log(
      `Found ${totalPendingBills} pending/partially-delivered bills from previous month`,
    );
    console.log(
      `Selected ${pendingBills.length} bill(s) for processing in this run`,
    );

    if (pendingBills.length === 0) {
      console.log("No pending bills found for auto-delivery");
      results.totalProcessed = 0;
    } else {
      // Process each bill with complete isolation per distributor
      for (const bill of pendingBills) {
        results.totalProcessed++;
        const billNo = bill.new_billno || bill.billNo;
        const billId = String(bill._id);
        const userId = bill.distributorId._id;

        if (!bill.distributorId || !bill.distributorId._id) {
          console.error(
            `✗ CRITICAL: Bill ${billNo} has no valid distributor, skipping`,
          );
          results.errors.push({
            billNo: billNo,
            billId: billId,
            error: "Missing distributor information",
          });
          results.failed++;
          continue;
        }

        // Get distributor details for logging
        let distributorInfo = "Unknown";
        try {
          const dist = await Distributor.findById(userId)
            .select("dbCode name")
            .lean();
          distributorInfo = dist
            ? `${dist.dbCode || dist.name || userId}`
            : userId.toString();
        } catch (e) {
          distributorInfo = userId.toString();
        }

        console.log(
          `\n════════════════════════════════════════════════════════`,
        );
        console.log(`Processing bill: ${billNo} (ID: ${billId})`);
        console.log(`Distributor: ${distributorInfo} (ID: ${userId})`);

        // Check if lineItems are properly populated
        const totalItems = bill.lineItems?.length || 0;
        const populatedItems =
          bill.lineItems?.filter((item) => item.product && item.inventoryId)
            .length || 0;
        const missingData = totalItems - populatedItems;

        if (missingData > 0) {
          console.warn(
            `  ⚠ WARNING: ${missingData} of ${totalItems} line items have missing product/inventory data`,
          );
        }

        console.log(`════════════════════════════════════════════════════════`);

        // ============ CHECK BACKDATE BILLING SETTING ============

        const deliverySetting = await BillDeliverySetting.findOne({
          distributorId: userId,
        });

        // If backdate billing is NOT enabled, skip this bill (no auto-delivery)
        if (
          !deliverySetting ||
          deliverySetting.enableBackdateBilling !== true
        ) {
          const reason = !deliverySetting
            ? "No delivery configuration found"
            : "Backdate billing is disabled - manual delivery allowed, no auto-delivery cron";

          console.log(`  ⊘ SKIPPED: ${reason}`);
          results.skipped++;
          results.bills.push({
            billNo: billNo,
            billId: billId,
            distributorId: userId.toString(),
            status: "skipped",
            reason: reason,
          });
          continue;
        }

        console.log(
          `  ✓ Backdate billing is enabled for this distributor - proceeding with auto-delivery`,
        );

        try {
          // Calculate delivery date and backdate fields FIRST (before inventory adjustment)
          const actualDeliveryDate = new Date();
          const backdateFields = calculateBackdateFields(
            bill.createdAt,
            actualDeliveryDate,
            deliverySetting.enableBackdateBilling,
            null,
          );

          // When backdate billing is enabled, force backdate for pending bills in this cron run.
          // Uses bill generation timestamp (createdAt) month-end only, never order date.
          if (deliverySetting.enableBackdateBilling === true) {
            const forcedBackdateDeliveryDate = moment
              .tz(bill.createdAt, "Asia/Kolkata")
              .endOf("month")
              .hour(5) // ← add this
              .minute(30) // ← add this
              .second(0) // ← add this
              .millisecond(0) // ← add this
              .toDate();

            backdateFields.deliveryDate = forcedBackdateDeliveryDate;
            backdateFields.originalDeliveryDate = actualDeliveryDate;
            backdateFields.enabledBackDate = true;
          }

          // deliveryDate will be set to last date of billing month if backdate is enabled
          bill.dates.deliveryDate = backdateFields.deliveryDate;
          bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
          bill.enabledBackDate = backdateFields.enabledBackDate;

          // Store backdateFields for passing to transaction creation
          bill.backdateFields = backdateFields;

          // Log backdate info only if actually applied
          if (backdateFields.enabledBackDate) {
            console.log(
              `  📅 Backdate applied: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Transaction date=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
            );
          }

          let adjustedCount = 0;
          let failedCount = 0;

          // Process each line item for inventory adjustment
          for (const item of bill.lineItems) {
            if (isNonAdjustableItem(item)) {
              console.log(
                `  ⊘ Skipping non-adjustable item: ${item.itemBillType}`,
              );
              continue;
            }

            try {
              await adjustSingleLineItem(item, billId, billNo, userId, bill);
              adjustedCount++;
              console.log(
                `  ✓ Adjusted product: ${item.product?.name || item.product?.product_code || "Unknown"}`,
              );
            } catch (error) {
              failedCount++;
              item.adjustmentStatus = "failed";
              item.adjustmentError = error.message;
              item.adjustmentNonRetriable = error.nonRetriable || false;

              const productInfo = item.product
                ? item.product.productName ||
                  item.product.productCode ||
                  `ID: ${item.product._id || item.product}`
                : "Product Missing";
              const inventoryInfo = item.inventoryId
                ? `Inv ID: ${item.inventoryId._id || item.inventoryId}`
                : "Inventory Missing";

              console.warn(
                `  ✗ Failed to adjust: ${productInfo} (${inventoryInfo}) - ${error.message}`,
              );
            }
          }

          const adjustableItems = getAdjustableItems(bill);

          // Update adjustment summary
          bill.adjustmentSummary = {
            totalProducts: adjustedCount + failedCount,
            successfulAdjustments: adjustedCount,
            failedAdjustments: failedCount,
            lastRetryAttempt: new Date(),
          };

          let productAdjustmentFailed = failedCount > 0;

          // Create ledger entries if all products adjusted successfully
          if (!productAdjustmentFailed && adjustedCount > 0) {
            try {
              await createLedgerEntries(bill, userId, bill.backdateFields);
              console.log(
                `  ✓ Ledger entries created for distributor ${distributorInfo}`,
              );
            } catch (ledgerError) {
              console.warn(
                `  ⚠ Ledger creation failed for distributor ${distributorInfo}: ${ledgerError.message}`,
              );
            }
          }

          let distributorRewardSuccess = false;
          let retailerRewardSuccess = false;
          let rewardStatus = { skipped: true };

          const distributor = await Distributor.findById(userId);
          const shouldCheckReward =
            bill.totalBasePoints > 0 && distributor?.RBPSchemeMapped === "yes";

          // Transfer rewards if at least ONE product was successfully delivered AND distributor is RBP mapped
          // The createSalesRewardPoints function will calculate rewards based on successfully delivered items only
          if (adjustedCount > 0 && shouldCheckReward) {
            try {
              rewardStatus = await createSalesRewardPoints(bill, userId);

              if (!rewardStatus.skipped) {
                distributorRewardSuccess = !!rewardStatus.distributorTxn;
                retailerRewardSuccess = !!rewardStatus.retailerTxn;

                if (distributorRewardSuccess && retailerRewardSuccess) {
                  console.log(
                    `  ✓ Rewards transferred successfully for distributor ${distributorInfo}`,
                  );
                } else {
                  console.warn(
                    `  ⚠ Partial reward transfer for distributor ${distributorInfo}`,
                  );
                }
              }
            } catch (rewardError) {
              console.warn(
                `  ⚠ Error transferring rewards for distributor ${distributorInfo}: ${rewardError.message}`,
              );
            }
          }

          if (failedCount > 0) {
            // Some products failed inventory adjustment
            bill.status = "Partially-Delivered";
          } else if (adjustedCount === 0) {
            // No products were adjusted
            bill.status = "Pending";
          } else if (shouldCheckReward) {
            // RBP is mapped - both rewards must succeed for "Delivered"
            bill.status =
              distributorRewardSuccess && retailerRewardSuccess
                ? "Delivered"
                : "Partially-Delivered";
          } else {
            // RBP not mapped - successful inventory adjustment = delivered
            bill.status = "Delivered";
          }

          if (bill.status === "Delivered") {
            console.log(`  ✓ Bill marked as DELIVERED`);
          } else if (bill.status === "Partially-Delivered") {
            console.log(`  ⚠ Bill marked as PARTIALLY-DELIVERED`);
          } else {
            console.log(
              `  ⊘ Bill kept PENDING (no items adjusted: adjusted=${adjustedCount}, failed=${failedCount})`,
            );
          }

          if (backdateFields.enabledBackDate) {
            console.log(
              `  📅 Backdate applied: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Multiplier date=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
            );
          }

          // Clean up invalid goodsType values before saving
          // goodsType must be either "Billed", "Replacement", or undefined - not empty string
          for (const item of bill.lineItems || []) {
            if (item.goodsType === "" || item.goodsType === null) {
              item.goodsType = undefined;
            }
          }

          // Mark lineItems as modified so Mongoose saves the adjustmentStatus changes
          bill.markModified("lineItems");

          await bill.save();

          try {
            await updateSecondaryTargetAchievement(bill, userId);
            console.log(
              `  ✓ Updated secondary target achievement for distributor ${distributorInfo}`,
            );
          } catch (targetError) {
            console.warn(
              `  ⚠ Error updating secondary target for distributor ${distributorInfo}: ${targetError.message}`,
            );
          }

          try {
            await checkAndUpdatePortalLock(userId);
            console.log(
              `  ✓ Portal lock status checked for distributor ${distributorInfo}`,
            );
          } catch (lockError) {
            console.warn(
              `  ⚠ Error checking portal lock for distributor ${distributorInfo}: ${lockError.message}`,
            );
          }

          results.bills.push({
            billNo: billNo,
            billId: billId,
            status: bill.status,
            adjusted: adjustedCount,
            failed: failedCount,
            distributorId: userId.toString(),
            distributorReward: shouldCheckReward
              ? distributorRewardSuccess
                ? "success"
                : "pending"
              : "not_required",
            retailerReward: shouldCheckReward
              ? retailerRewardSuccess
                ? "success"
                : "pending"
              : "not_required",
            rewardPoints: rewardStatus.distributorTxn
              ? rewardStatus.distributorTxn.point
              : 0,
          });

          if (bill.status === "Delivered") {
            results.success++;
          } else if (bill.status === "Partially-Delivered") {
            results.failed++;
          } else {
            results.skipped++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            billNo: billNo,
            billId: billId,
            distributorId: userId.toString(),
            error: error.message,
          });
          console.error(
            `  ✗ CRITICAL ERROR processing bill ${billNo} for distributor ${distributorInfo}: ${error.message}`,
          );
          console.error(`  Stack trace:`, error.stack);
        }

        console.log(
          `════════════════════════════════════════════════════════\n`,
        );
      }
    }

    console.log(`\n========== AUTO PENDING BILL DELIVERY COMPLETED ==========`);
    console.log(`Results Summary:`);
    console.log(`  Total Processed: ${results.totalProcessed}`);
    console.log(`  Successfully Delivered: ${results.success}`);
    console.log(`  Partially Delivered: ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log(`  Errors: ${results.errors.length}`);
    console.log(`\n[CONFIG] Cron Info:`);
    console.log(
      `  Config Set At: ${autoPendingBillCronSetAt ? moment(autoPendingBillCronSetAt).format("YYYY-MM-DD HH:mm:ss") : "Not configured"}`,
    );
    console.log(`========================================================\n`);

    if (res) {
      return res.json({
        error: false,
        message: "Auto pending bill delivery completed",
        results: results,
        config: {
          cronSetAt: autoPendingBillCronSetAt,
        },
      });
    }

    return results;
  } catch (error) {
    console.error("Error in autoPendingBillDelivery:", error.message);

    const response = {
      error: true,
      message: "Error during auto pending bill delivery",
      details: error.message,
      results: results,
    };

    if (res) {
      return res.status(500).json(response);
    }

    return response;
  }
});

async function adjustSingleLineItem(item, billId, billNo, userId, bill) {
  if (!item.product || !item.inventoryId) {
    throw new AdjustmentError(
      `Missing product or inventory data for item in bill ${billNo}`,
      true,
    );
  }

  const billQty = Number(item.billQty || 0);
  const invId = item.inventoryId._id || item.inventoryId;
  const productId = item.product._id || item.product;

  if (!productId || !invId || billQty <= 0) {
    throw new AdjustmentError(
      `Invalid product (${productId}), inventory (${invId}), or quantity (${billQty})`,
      true,
    );
  }

  const backdateFields = bill.backdateFields || {
    deliveryDate: bill.dates?.deliveryDate || new Date(),
    originalDeliveryDate: bill.dates?.originalDeliveryDate || new Date(),
    enabledBackDate: bill.enabledBackDate || false,
  };

  if (String(bill.distributorId._id) !== String(userId)) {
    throw new AdjustmentError(
      `ISOLATION ERROR: Bill distributor mismatch! Expected ${userId}, got ${bill.distributorId._id}`,
      true,
    );
  }

  // Check if already adjusted (prevents double-adjustment)
  const alreadyAdjustedNew = await Transaction.findOne({
    billId: billId,
    billLineItemId: item._id,
    transactionType: "delivery",
    type: "Out",
  });

  const alreadyAdjustedOld = await Transaction.findOne({
    billId: billId,
    productId: productId,
    transactionType: "delivery",
    type: "Out",
    billLineItemId: { $exists: false },
  });

  if (alreadyAdjustedNew || alreadyAdjustedOld) {
    item.adjustmentStatus = "success";
    return;
  }

  const inventory = await Inventory.findById(invId);
  if (!inventory) throw new AdjustmentError("Inventory not found", true);

  if (String(inventory.distributorId) !== String(userId)) {
    throw new AdjustmentError(
      `ISOLATION ERROR: Inventory belongs to different distributor! Expected ${userId}, got ${inventory.distributorId}`,
      true,
    );
  }

  const reserved = Number(inventory.reservedQty || 0);
  const available = Number(inventory.availableQty || 0);
  const total = reserved + available;

  if (total < billQty) {
    throw new AdjustmentError(
      `Insufficient stock. Available: ${total}, Required: ${billQty}`,
      false,
    );
  }

  if (reserved < billQty) {
    throw new AdjustmentError(
      `Insufficient reserved stock. Reserved: ${reserved}, Required: ${billQty}. Total available: ${total}`,
      false,
    );
  }

  const txnId = await transactionCode("LXSTA");

  // Only for THIS distributor's inventory
  const updateData = {
    $inc: {
      reservedQty: -billQty,
    },
  };

  // Apply backdate to inventory timestamps if backdate is enabled
  if (backdateFields.enabledBackDate && backdateFields.deliveryDate) {
    updateData.updatedAt = backdateFields.deliveryDate;
    updateData.lastDeliveryDate = backdateFields.deliveryDate;
  }

  const updated = await Inventory.findOneAndUpdate(
    {
      _id: invId,
      distributorId: userId,
      reservedQty: { $gte: billQty },
    },
    updateData,
    { new: true },
  );

  if (!updated) {
    throw new AdjustmentError(
      "Concurrent stock update or inventory ownership mismatch",
      false,
    );
  }

  // Create transaction record
  const transactionData = {
    distributorId: userId,
    productId: productId,
    invItemId: invId,
    billId: billId,
    billLineItemId: item._id,
    date: backdateFields.deliveryDate,
    qty: billQty,
    transactionId: txnId,
    type: "Out",
    transactionType: "delivery",
    stockType: "salable",
    description: `Delivered against Bill ${billNo}`,
    dates: {
      deliveryDate: backdateFields.deliveryDate,
      originalDeliveryDate: backdateFields.originalDeliveryDate,
    },
    enabledBackDate: backdateFields.enabledBackDate,
  };

  // Set timestamps based on backdate setting
  if (backdateFields.enabledBackDate && backdateFields.deliveryDate) {
    transactionData.createdAt = backdateFields.deliveryDate;
    transactionData.updatedAt = backdateFields.deliveryDate;
    await Transaction.create([transactionData], { timestamps: false });
  } else {
    await Transaction.create(transactionData);
  }

  // Create stock ledger entry
  try {
    const createdTransaction = await Transaction.findOne({
      transactionId: txnId,
      billLineItemId: item._id,
    }).lean();

    if (createdTransaction) {
      await createStockLedgerEntry(createdTransaction._id);
    }
  } catch (ledgerError) {
    console.warn(
      `⚠ Stock ledger creation failed for transaction ${txnId}: ${ledgerError.message}`,
    );
  }

  item.adjustmentStatus = "success";
}

module.exports = {
  autoPendingBillDelivery,
};
