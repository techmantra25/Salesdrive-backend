const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const Bill = require("../../../models/bill.model");
const BillDeliverySetting = require("../../../models/billDeliverySetting.model");
const Transaction = require("../../../models/transaction.model");
const Ledger = require("../../../models/ledger.model");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const { calculateBackdateFields } = require("../../../utils/backdateHelper");

let Distributor;
try {
  Distributor = require("../../../models/distributor.model");
} catch {
  Distributor = null;
}

const {
  adjustSingleLineItem,
  createLedgerEntries,
  createSalesRewardPoints,
  createDistributorRewardTransaction,
  createRetailerRewardTransaction,
} = require("./deliverBillUpdate");

/* ===================== HELPERS ============================ */

const isNonAdjustableItem = (item) =>
  item.itemBillType === "Item Removed" ||
  item.itemBillType === "Stock out" ||
  Number(item.billQty) <= 0;

const getAdjustableItems = (bill) =>
  bill.lineItems.filter((i) => !isNonAdjustableItem(i));

const resolveRetryBackdateFields = (
  bill,
  enableBackdateBilling,
  actualDeliveryDate,
) => {
  if (bill?.dates?.deliveryDate) {
    return {
      deliveryDate: bill.dates.deliveryDate,
      originalDeliveryDate:
        bill.dates.originalDeliveryDate || bill.dates.deliveryDate,
      enabledBackDate: bill.enabledBackDate === true,
    };
  }

  return calculateBackdateFields(
    bill.createdAt,
    actualDeliveryDate,
    enableBackdateBilling,
  );
};

/* ================== BULK RETRY (CRON) ==================== */

const billBulkRetry = asyncHandler(async (req, res) => {
  console.log("\n[CRON] ===== BILL BULK RETRY STARTED =====");

  const { billIds = [], limit = 100 } = req.body || {};

  const query = {
    status: "Partially-Delivered",
    ...(billIds.length ? { _id: { $in: billIds } } : {}),
  };

  const bills = await Bill.find(query)
    .populate("lineItems.product lineItems.inventoryId")
    .sort({ updatedAt: 1 })
    .limit(limit);

  const summary = {
    totalBills: bills.length,
    delivered: 0,
    stillPartial: 0,
    itemsRetried: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    distributorRewardsTransferred: 0,
    retailerRewardsTransferred: 0,
    rewardsFailed: 0,
    lowBalanceErrors: 0,
  };

  for (const bill of bills) {
    const finalBillNo = bill.new_billno || bill.billNo;
    console.log(`\n[CRON] 🔄 === Processing Bill ${finalBillNo} ===`);

    if (!bill._id || !bill.billNo) {
      console.log(`[CRON] ⏭️ Skipping - missing ID or billNo`);
      continue;
    }

    const billId = String(bill._id);
    const billNo = bill.billNo;
    const userId = bill.distributorId;

    /* ========== CALCULATE BACKDATE FIELDS EARLY ========== */
    const deliverySetting = await BillDeliverySetting.findOne({
      distributorId: userId,
    });
    const enableBackdateBilling =
      deliverySetting?.enableBackdateBilling === true;

    const actualDeliveryDate = new Date();
    const backdateFields = resolveRetryBackdateFields(
      bill,
      enableBackdateBilling,
      actualDeliveryDate,
    );

    // Store backdateFields for passing to transaction creation
    bill.backdateFields = backdateFields;

    /* ========== STEP 1: CHECK CURRENT STATE ========== */

    const adjustableItems = getAdjustableItems(bill);
    let adjustedCount = 0;
    let failedCount = 0;

    for (const item of adjustableItems) {
      const isAdjusted = await Transaction.exists({
        billId,
        billLineItemId: item._id,
        transactionType: "delivery",
        type: "Out",
      });

      if (isAdjusted) {
        adjustedCount++;
      } else {
        failedCount++;
      }
    }

    const existingDistributorTxn = await DistributorTransaction.findOne({
      billId: bill._id,
      distributorId: userId,
      transactionFor: "SALES",
      status: "Success",
    });

    const existingRetailerTxn = await RetailerOutletTransaction.findOne({
      billId: bill._id,
      transactionFor: "SALES",
      status: "Success",
    });

    const distributor = await Distributor.findById(userId);
    const shouldCheckReward =
      bill.totalBasePoints > 0 && distributor?.RBPSchemeMapped === "yes";

    console.log(`[CRON] 📊 Current State:`);
    console.log(
      `[CRON]    Products: ${adjustedCount}/${adjustableItems.length}`,
    );
    console.log(
      `[CRON]    Dist Reward: ${existingDistributorTxn ? "✅" : "❌"}`,
    );
    console.log(
      `[CRON]    Retailer Reward: ${existingRetailerTxn ? "✅" : "❌"}`,
    );

    /* ========== STEP 2: RETRY FAILED PRODUCTS ========== */

    if (failedCount > 0) {
      console.log(`[CRON] 🔧 Retrying ${failedCount} failed products...`);

      for (const item of bill.lineItems) {
        if (isNonAdjustableItem(item)) continue;

        const alreadyAdjusted = await Transaction.exists({
          billId,
          billLineItemId: item._id,
          transactionType: "delivery",
          type: "Out",
        });

        if (alreadyAdjusted) {
          item.adjustmentStatus = "success";
          continue;
        }

        summary.itemsRetried++;

        try {
          await adjustSingleLineItem(item, billId, billNo, userId, {
            forceRetry: true,
            deliveryDate: backdateFields.deliveryDate,
            backdateFields,
          });

          summary.itemsSucceeded++;
          item.adjustmentStatus = "success";
          console.log(`[CRON]    ✅ Product adjusted`);
        } catch (err) {
          summary.itemsFailed++;
          item.adjustmentStatus = "failed";
          item.adjustmentError = err.message;
          item.adjustmentNonRetriable = err.nonRetriable || false;
          console.log(`[CRON]    ❌ Product failed: ${err.message}`);
        }
      }
    } else {
      console.log(`[CRON] ✅ All products already adjusted`);
    }

    /* ========== STEP 3: RECOUNT AFTER PRODUCT RETRY ========== */

    adjustedCount = 0;
    failedCount = 0;
    let allProductsAdjusted = true;

    for (const item of adjustableItems) {
      const isAdjusted = await Transaction.exists({
        billId,
        billLineItemId: item._id,
        transactionType: "delivery",
        type: "Out",
      });

      if (isAdjusted) {
        adjustedCount++;
      } else {
        failedCount++;
        allProductsAdjusted = false;
      }
    }

    console.log(
      `[CRON] 📊 After Product Retry: ${adjustedCount}/${adjustableItems.length}`,
    );

    /* ========== STEP 4: LEDGER CREATION ========== */

    let ledgerExists = false;

    if (allProductsAdjusted && failedCount === 0) {
      console.log(`[CRON] 📒 Checking/Creating ledger entries...`);
      try {
        // Check if ledger already exists
        const existingLedger = await Ledger.exists({
          billId: bill._id,
          dbId: userId,
          retailerId: bill.retailerId,
          transactionFor: "Sales",
        });

        if (existingLedger) {
          ledgerExists = true;
          console.log(`[CRON]    ✅ Ledger already exists`);
        } else {
          await createLedgerEntries(bill, userId, backdateFields);
          ledgerExists = true;
          console.log(`[CRON]    ✅ Ledger created`);
        }
      } catch (error) {
        ledgerExists = false;
        console.log(`[CRON]    ⚠️ Ledger failed: ${error.message}`);
      }
    } else {
      console.log(`[CRON] ⏭️ Skipping ledger - products not all adjusted`);
    }

    /* ========== STEP 5: REWARD RETRY LOGIC ========== */

    if (shouldCheckReward && allProductsAdjusted && ledgerExists) {
      console.log(`[CRON] 💰 Attempting reward transfer...`);

      // Calculate reward points
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

      if (rewardPoints !== bill.totalBasePoints) {
        rewardPoints = bill.totalBasePoints;
      }

      console.log(`[CRON]    Required Points: ${rewardPoints}`);

      // Re-check status
      const distTxnAfterRetry = await DistributorTransaction.findOne({
        billId: bill._id,
        distributorId: userId,
        transactionFor: "SALES",
        status: "Success",
      });

      const retailTxnAfterRetry = await RetailerOutletTransaction.findOne({
        billId: bill._id,
        transactionFor: "SALES",
        status: "Success",
      });

      const retailer = await OutletApproved.findById(bill.retailerId).lean();

      try {
        /* --- CASE 1: Both exist --- */
        if (distTxnAfterRetry && retailTxnAfterRetry) {
          console.log(`[CRON]    ✅ Both rewards already completed`);
          summary.distributorRewardsTransferred++;
          summary.retailerRewardsTransferred++;
        } else if (distTxnAfterRetry && !retailTxnAfterRetry) {
          /* --- CASE 2: Distributor exists, retailer missing --- */
          console.log(`[CRON]    🔄 Retrying retailer reward...`);

          if (!retailer?.outletUID) {
            throw new Error("Retailer UID missing");
          }

          await createRetailerRewardTransaction(
            bill,
            userId,
            rewardPoints,
            distTxnAfterRetry,
            distributor,
            retailer,
          );

          console.log(`[CRON]    ✅ Retailer reward created`);
          summary.distributorRewardsTransferred++;
          summary.retailerRewardsTransferred++;
        } else if (!distTxnAfterRetry && retailTxnAfterRetry) {
          /* --- CASE 3: Distributor missing, retailer exists --- */
          console.log(
            `[CRON]    ⚠️ Inconsistent: Retailer exists, distributor missing`,
          );
          console.log(`[CRON]    🔄 Creating distributor reward...`);

          if (!retailer?.outletUID) {
            throw new Error("Retailer UID missing");
          }

          const newDistTxn = await createDistributorRewardTransaction(
            bill,
            userId,
            rewardPoints,
            distributor,
            retailer,
          );

          if (newDistTxn) {
            console.log(`[CRON]    ✅ Distributor reward created`);
            summary.distributorRewardsTransferred++;
            summary.retailerRewardsTransferred++; // Retailer already existed
          }
        } else {
          /* --- CASE 4: Both missing --- */
          console.log(`[CRON]    🔄 Creating both rewards...`);

          const { distributorTxn, retailerTxn } = await createSalesRewardPoints(
            bill,
            userId,
            distributor,
          );

          if (distributorTxn) {
            summary.distributorRewardsTransferred++;
            console.log(`[CRON]    ✅ Distributor reward created`);
          } else {
            console.log(`[CRON]    ❌ Distributor reward failed`);
          }

          if (retailerTxn) {
            summary.retailerRewardsTransferred++;
            console.log(`[CRON]    ✅ Retailer reward created`);
          } else {
            console.log(`[CRON]    ❌ Retailer reward failed`);
          }

          if (!distributorTxn || !retailerTxn) {
            summary.rewardsFailed++;
          }
        }
      } catch (error) {
        summary.rewardsFailed++;
        console.log(`[CRON]    ❌ Reward failed: ${error.message}`);

        if (error.lowBalance) {
          summary.lowBalanceErrors++;
          console.log(
            `[CRON]    ⚠️ Low balance: Required=${error.required}, Available=${error.available}`,
          );
        }
      }
    } else if (!shouldCheckReward) {
      console.log(`[CRON] ⏭️ Skipping rewards - RBP not mapped or no points`);
    } else if (!allProductsAdjusted) {
      console.log(`[CRON] ⏭️ Skipping rewards - products not all adjusted`);
    } else if (!ledgerExists) {
      console.log(
        `[CRON] ⏭️ Skipping rewards - ledger entries missing or failed`,
      );
    }

    /* ========== STEP 6: DETERMINE FINAL STATUS ========== */

    const finalDistributorReward = await DistributorTransaction.exists({
      billId: bill._id,
      distributorId: userId,
      transactionFor: "SALES",
      status: "Success",
    });

    const finalRetailerReward = await RetailerOutletTransaction.exists({
      billId: bill._id,
      transactionFor: "SALES",
      status: "Success",
    });

    // Final count
    adjustedCount = 0;
    failedCount = 0;
    for (const item of adjustableItems) {
      const isAdjusted = await Transaction.exists({
        billId,
        billLineItemId: item._id,
        transactionType: "delivery",
        type: "Out",
      });
      if (isAdjusted) {
        adjustedCount++;
      } else {
        failedCount++;
      }
    }

    // ============ STEP 6: DETERMINE FINAL BILL STATUS ============
    // Bill Status Logic Documentation:
    //
    // Scenario 1: Inventory adjustment FAILED (failedCount > 0)
    //   → bill.status = "Partially-Delivered"
    //
    // Scenario 2: NO items adjusted (adjustedCount === 0)
    //   → bill.status = "Pending"
    //
    // Scenario 3: RBP NOT mapped + all items adjusted (failedCount === 0, adjustedCount > 0)
    //   → bill.status = "Delivered" (no reward check needed)
    //
    // Scenario 4: RBP MAPPED + all items adjusted (failedCount === 0, adjustedCount > 0)
    //   → IF both distributor AND retailer rewards successful
    //       • bill.status = "Delivered"
    //   → ELSE (reward creation failed/skipped)
    //       • bill.status = "Partially-Delivered"

    if (failedCount > 0) {
      // Some products failed inventory adjustment
      bill.status = "Partially-Delivered";
    } else if (adjustedCount === 0) {
      // No products were adjusted
      bill.status = "Pending";
    } else if (shouldCheckReward) {
      // RBP is mapped - both rewards must succeed for "Delivered"
      bill.status =
        finalDistributorReward && finalRetailerReward
          ? "Delivered"
          : "Partially-Delivered";
    } else {
      // RBP not mapped - successful inventory adjustment = delivered
      bill.status = "Delivered";
    }

    /* ========== STEP 7: UPDATE BILL ========== */

    bill.adjustmentSummary = {
      totalProducts: adjustedCount + failedCount,
      successfulAdjustments: adjustedCount,
      failedAdjustments: failedCount,
      lastRetryAttempt: new Date(),
    };

    // Update delivery dates (backdateFields already calculated at the start)
    bill.dates.deliveryDate = backdateFields.deliveryDate;
    bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
    bill.enabledBackDate = backdateFields.enabledBackDate;

    if (backdateFields.enabledBackDate) {
      console.log(
        `[CRON] 📅 Backdate applied for bill ${finalBillNo}: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Multiplier date=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
      );
    }

    // Clean up invalid goodsType values before saving
    // goodsType must be either "Billed", "Replacement", or undefined - not empty string
    for (const item of bill.lineItems || []) {
      if (item.goodsType === "" || item.goodsType === null) {
        item.goodsType = undefined;
      }
    }

    bill.markModified("lineItems");
    await bill.save();

    // Update summary
    if (bill.status === "Delivered") {
      summary.delivered++;
    } else {
      summary.stillPartial++;
    }

    console.log(
      `[CRON] 📊 Final: ${bill.status} | Products: ${adjustedCount}/${
        adjustableItems.length
      } | Dist: ${finalDistributorReward ? "✅" : "❌"} | Retailer: ${
        finalRetailerReward ? "✅" : "❌"
      }`,
    );
  }

  console.log("\n[CRON] ===== BILL BULK RETRY COMPLETED =====");
  console.log(JSON.stringify(summary, null, 2));

  return res?.status?.(200)?.json?.({
    status: 200,
    message: "Bulk retry completed",
    data: summary,
  });
});

module.exports = {
  billBulkRetry,
};
