// const asyncHandler = require("express-async-handler");
// const Bill = require("../../models/bill.model");
// const Product = require("../../models/product.model");
// const Transaction = require("../../models/transaction.model");
// const DistributorTransaction = require("../../models/distributorTransaction.model");
// let Distributor;
// try {
//   Distributor = require("../../models/distributor.model");
// } catch {
//   Distributor = null;
// }
// const {
//   adjustSingleLineItem,
//   createLedgerEntries,
//   createSalesRewardPoints,
// } = require("./deliverBillUpdate");

// /* ===================== HELPERS ============================ */

// const isNonAdjustableItem = (item) =>
//   item.itemBillType === "Item Removed" ||
//   item.itemBillType === "Stock out" ||
//   Number(item.billQty) <= 0;

// const getAdjustableItems = (bill) =>
//   bill.lineItems.filter((i) => !isNonAdjustableItem(i));

// /* ================== PROCESS SINGLE BILL ==================== */
// const processSingleBillOptimized = async (
//   bill,
//   userId,
//   summary,
//   isRBPMapped,
//   currentBalance
// ) => {
//   if (!bill._id || !bill.billNo || !bill.distributorId) {
//     console.warn(`[CRON] Skipping bill with missing data`);
//     return;
//   }

//   const billId = String(bill._id);
//   const billNo = bill.new_billno || bill.billNo;
//   const distId = String(userId);

//   console.log(`\n[CRON] --- Processing Bill ${billNo} (${billId}) ---`);

//   let adjustedCount = 0;
//   let failedCount = 0;

//   const adjustableItems = getAdjustableItems(bill);

//   /* ---------- STEP 1: CHECK EXISTING ADJUSTMENTS ---------- */
//   console.log(`[CRON] Checking existing adjustments for Bill ${billNo}`);

//   const itemIds = adjustableItems.map((item) => item._id);
//   const productIds = adjustableItems.map(
//     (item) => item.product?._id || item.product
//   );

//   // Parallel check for existing adjustments (both formats)
//   const [newFormatTransactions, oldFormatTransactions] = await Promise.all([
//     Transaction.find({
//       billId,
//       billLineItemId: { $in: itemIds },
//       distributorId: userId,
//       transactionType: "delivery",
//       type: "Out",
//     })
//       .select("billLineItemId")
//       .lean(),

//     Transaction.find({
//       billId,
//       productId: { $in: productIds },
//       distributorId: userId,
//       transactionType: "delivery",
//       type: "Out",
//       billLineItemId: { $exists: false },
//     })
//       .select("productId")
//       .lean(),
//   ]);

//   const adjustedItemIds = new Set(
//     newFormatTransactions.map((t) => String(t.billLineItemId))
//   );
//   const adjustedProductIds = new Set(
//     oldFormatTransactions.map((t) => String(t.productId))
//   );

//   // Mark already adjusted items
//   adjustableItems.forEach((item) => {
//     const itemId = String(item._id);
//     const productId = String(item.product?._id || item.product);

//     if (adjustedItemIds.has(itemId)) {
//       adjustedCount++;
//       item.adjustmentStatus = "success";
//       item.adjustmentFormat = "new";
//     } else if (adjustedProductIds.has(productId)) {
//       adjustedCount++;
//       item.adjustmentStatus = "success";
//       item.adjustmentFormat = "old";
//       console.log(`[CRON] ℹ️ Item ${itemId} marked as adjusted (old format)`);
//     }
//   });

//   console.log(
//     `[CRON] Bill ${billNo}: ${adjustedCount}/${adjustableItems.length} already adjusted (New: ${adjustedItemIds.size}, Old: ${adjustedProductIds.size})`
//   );

//   /* ---------- STEP 2: RETRY FAILED ADJUSTMENTS ---------- */
//   for (const item of adjustableItems) {
//     if (isNonAdjustableItem(item) || item.adjustmentStatus === "success") {
//       continue;
//     }

//     // This item needs adjustment
//     summary.itemsRetried++;
//     summary.byDistributor[distId].itemsRetried++;

//     try {
//       await adjustSingleLineItem(item, billId, billNo, userId, {
//         forceRetry: true,
//       });
//       adjustedCount++;
//       summary.itemsSucceeded++;
//       summary.byDistributor[distId].itemsSucceeded++;
//       item.adjustmentStatus = "success";
//       item.adjustmentError = null;
//       console.log(`[CRON] ✅ Adjusted item ${item._id} for Bill ${billNo}`);
//     } catch (err) {
//       failedCount++;
//       summary.itemsFailed++;
//       summary.byDistributor[distId].itemsFailed++;
//       item.adjustmentStatus = "failed";
//       item.adjustmentError = err.message;
//       item.adjustmentNonRetriable = err.nonRetriable || false;
//       console.log(
//         `[CRON] ❌ Adjustment failed for Bill ${billNo}, Item ${item._id}: ${err.message}`
//       );
//     }
//   }

//   /* ---------- STEP 3: VERIFY ALL ITEMS ADJUSTED ---------- */
//   const [finalCheckNew, finalCheckOld] = await Promise.all([
//     Transaction.find({
//       billId,
//       billLineItemId: { $in: itemIds },
//       distributorId: userId,
//       transactionType: "delivery",
//       type: "Out",
//     })
//       .select("billLineItemId")
//       .lean(),

//     Transaction.find({
//       billId,
//       productId: { $in: productIds },
//       distributorId: userId,
//       transactionType: "delivery",
//       type: "Out",
//       billLineItemId: { $exists: false },
//     })
//       .select("productId")
//       .lean(),
//   ]);

//   const finalAdjustedNew = new Set(
//     finalCheckNew.map((t) => String(t.billLineItemId))
//   );
//   const finalAdjustedOld = new Set(
//     finalCheckOld.map((t) => String(t.productId))
//   );

//   // Check if ALL adjustable items are now adjusted
//   let allProductsAdjusted = adjustableItems.every((item) => {
//     const itemId = String(item._id);
//     const productId = String(item.product?._id || item.product);
//     return finalAdjustedNew.has(itemId) || finalAdjustedOld.has(productId);
//   });

//   console.log(
//     `[CRON] Bill ${billNo}: All products adjusted: ${allProductsAdjusted} (New: ${finalAdjustedNew.size}, Old: ${finalAdjustedOld.size})`
//   );

//   /* ---------- STEP 4: LEDGER & REWARD (ONLY IF ALL PRODUCTS ADJUSTED) ---------- */
//   let rewardSkippedDueToBalance = false;
//   let rewardTransferred = false;
//   let rewardNotRequired = false;

//   if (allProductsAdjusted && failedCount === 0) {
//     console.log(
//       `[CRON] All products adjusted for Bill ${billNo}. Proceeding to Ledger & Reward.`
//     );

//     // LEDGER (idempotent - will skip if already exists)
//     try {
//       await createLedgerEntries(bill, userId);
//       console.log(`[CRON] ✅ Ledger entries created for Bill ${billNo}`);
//     } catch (err) {
//       console.log(`[CRON] ❌ Ledger failed for Bill ${billNo}: ${err.message}`);
//     }

//     // REWARD TRANSFER LOGIC
//     try {
//       const shouldAttemptReward = isRBPMapped && bill.totalBasePoints > 0;

//       if (shouldAttemptReward) {
//         // RBP IS MAPPED - Check if reward already transferred
//         const existingReward = await DistributorTransaction.exists({
//           billId: bill._id,
//           distributorId: userId,
//           transactionFor: "SALES",
//           status: "Success",
//         });

//         if (existingReward) {
//           console.log(
//             `[CRON] ℹ️ Reward already transferred for Bill ${billNo}`
//           );
//           rewardTransferred = true;
//         } else {
//           // Reward not yet transferred - check balance and attempt transfer
//           const requiredPoints = bill.totalBasePoints;

//           if (currentBalance < requiredPoints) {
//             // INSUFFICIENT BALANCE - SKIP WITHOUT TRANSFER
//             console.log(
//               `[CRON] ⚠️ LOW BALANCE WARNING: Bill ${billNo} requires ${requiredPoints} points, but only ${currentBalance} points available. Reward transfer skipped. Please recharge wallet and retry.`
//             );
//             rewardSkippedDueToBalance = true;
//             summary.rewardsSkippedDueToBalance++;
//             summary.byDistributor[distId].rewardsSkippedDueToBalance++;

//             // Bill stays as Partially-Delivered for future retry when balance is sufficient
//           } else {
//             // SUFFICIENT BALANCE - PROCEED WITH REWARD TRANSFER
//             console.log(
//               `[CRON] Attempting reward for Bill ${billNo} (Balance: ${currentBalance}, Required: ${requiredPoints})`
//             );

//             await createSalesRewardPoints(bill, userId);
//             console.log(
//               `[CRON] ✅ Reward transferred successfully for Bill ${billNo}`
//             );
//             rewardTransferred = true;
//           }
//         }
//       } else {
//         // RBP NOT MAPPED or NO BASE POINTS - reward not required
//         console.log(
//           `[CRON] ℹ️ Reward not required for Bill ${billNo} (RBP mapped: ${isRBPMapped}, Points: ${bill.totalBasePoints})`
//         );
//         rewardNotRequired = true;
//       }
//     } catch (err) {
//       console.log(`[CRON] ❌ Reward error for Bill ${billNo}: ${err.message}`);

//       // Handle low balance error from createSalesRewardPoints
//       if (err.lowBalance) {
//         console.log(
//           `[CRON] ⚠️ LOW BALANCE ERROR: Bill ${err.billNo} requires ${err.required} points, but only ${err.available} points available.`
//         );
//         rewardSkippedDueToBalance = true;
//         summary.rewardsSkippedDueToBalance++;
//         summary.byDistributor[distId].rewardsSkippedDueToBalance++;
//       }
//       // For other errors, reward remains in failed state
//     }
//   } else {
//     console.log(
//       `[CRON] Cannot attempt ledger/reward for Bill ${billNo}: ${failedCount} products still failing`
//     );
//   }

//   /* ---------- STEP 5: DOUBLE-CHECK FINAL REWARD STATUS ---------- */
//   if (!rewardTransferred && !rewardNotRequired && allProductsAdjusted) {
//     const rewardTxn = await DistributorTransaction.exists({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     if (rewardTxn) {
//       rewardTransferred = true;
//     }
//   }

//   /* ---------- STEP 6: DETERMINE FINAL BILL STATUS ---------- */
//   if (failedCount === 0 && adjustedCount > 0) {
//     // All products adjusted successfully

//     if (isRBPMapped && bill.totalBasePoints > 0) {
//       // RBP IS MAPPED - reward transfer is REQUIRED
//       if (rewardSkippedDueToBalance) {
//         // Low balance - keep as Partially-Delivered for future retry
//         bill.status = "Partially-Delivered";
//         console.log(`[CRON] ${billNo} → Partially-Delivered (low balance)`);
//       } else if (rewardTransferred) {
//         // Reward successfully transferred - mark as Delivered
//         bill.status = "Delivered";
//         console.log(`[CRON] ${billNo} → Delivered (reward done)`);
//       } else {
//         // Reward failed for other reasons - keep as Partially-Delivered
//         bill.status = "Partially-Delivered";
//         console.log(`[CRON] ${billNo} → Partially-Delivered (reward pending)`);
//       }
//     } else {
//       // RBP NOT MAPPED or NO BASE POINTS - reward not required
//       bill.status = "Delivered";
//       console.log(`[CRON] ${billNo} → Delivered (no reward needed)`);
//     }
//   } else if (failedCount > 0) {
//     // Some products still failing - keep as Partially-Delivered
//     bill.status = "Partially-Delivered";
//     console.log(
//       `[CRON] ${billNo} → Partially-Delivered (${failedCount} products failed)`
//     );
//   } else {
//     // Edge case: no adjustable items
//     bill.status = "Pending";
//     console.log(`[CRON] ${billNo} → Pending (no adjustable items)`);
//   }

//   // Update adjustment summary and delivery date using findByIdAndUpdate
//   await Bill.findByIdAndUpdate(
//     billId,
//     {
//       $set: {
//         status: bill.status,
//         "dates.deliveryDate": new Date(),
//         adjustmentSummary: {
//           totalProducts: adjustableItems.length,
//           successfulAdjustments: adjustedCount,
//           failedAdjustments: failedCount,
//           lastRetryAttempt: new Date(),
//         },
//         lineItems: bill.lineItems,
//       },
//     },
//     { new: true }
//   );

//   // Update summary counters
//   summary.byDistributor[distId].billsProcessed++;

//   if (bill.status === "Delivered") {
//     summary.delivered++;
//     summary.byDistributor[distId].billsDelivered++;
//   } else {
//     summary.stillPartial++;
//     summary.byDistributor[distId].billsStillPartial++;
//   }

//   if (rewardTransferred && !rewardSkippedDueToBalance) {
//     summary.rewardsTransferred++;
//     summary.byDistributor[distId].rewardsTransferred++;
//   }

//   console.log(
//     `[CRON] Bill ${billNo} → ${bill.status} | Adjusted: ${adjustedCount}/${
//       adjustableItems.length
//     }, Failed: ${failedCount}, Reward: ${
//       rewardTransferred
//         ? "✅"
//         : rewardSkippedDueToBalance
//         ? "⚠️ Low Balance"
//         : rewardNotRequired
//         ? "ℹ️ Not Required"
//         : "❌"
//     }`
//   );
// };

// /* ================== BULK RETRY (CRON) ==================== */

// const billBulkRetry = asyncHandler(async (req, res) => {
//   console.log("\n[CRON] ===== BILL BULK RETRY STARTED =====");
//   console.log(`[CRON] Timestamp: ${new Date().toISOString()}`);

//   const { billIds = [], distributorId = null, batchSize = 3 } = req.body || {};

//   const query = {
//     status: "Partially-Delivered",
//     ...(billIds.length ? { _id: { $in: billIds } } : {}),
//     ...(distributorId ? { distributorId } : {}),
//   };

//   // Step 1: Get bill IDs only with minimal data
//   const billData = await Bill.find(query)
//     .select("_id distributorId")
//     .sort({ distributorId: 1, updatedAt: 1 });

//   console.log(`[CRON] Found ${billData.length} bills to process`);

//   if (billData.length === 0) {
//     console.log("[CRON] No bills to process. Exiting.");
//     return res?.status?.(200)?.json?.({
//       status: 200,
//       message: "No bills to process",
//       data: { totalBills: 0 },
//     });
//   }

//   // Step 2: Group by distributorId
//   const billsByDistributor = {};
//   for (let i = 0; i < billData.length; i++) {
//     const distId = String(billData[i].distributorId);
//     if (!billsByDistributor[distId]) {
//       billsByDistributor[distId] = [];
//     }
//     billsByDistributor[distId].push(billData[i]._id);
//   }

//   // Clear original array
//   billData.length = 0;

//   const distributorIds = Object.keys(billsByDistributor);
//   console.log(`[CRON] Processing ${distributorIds.length} distributors`);

//   const summary = {
//     totalDistributors: distributorIds.length,
//     totalBills: Object.values(billsByDistributor).reduce(
//       (sum, arr) => sum + arr.length,
//       0
//     ),
//     delivered: 0,
//     stillPartial: 0,
//     itemsRetried: 0,
//     itemsSucceeded: 0,
//     itemsFailed: 0,
//     rewardsTransferred: 0,
//     rewardsSkippedDueToBalance: 0,
//     byDistributor: {},
//   };

//   // Pre-cache distributor RBP mapping to avoid repeated queries
//   const distributorCache = {};
//   if (Distributor) {
//     const distributors = await Distributor.find({
//       _id: { $in: distributorIds },
//     })
//       .select("_id RBPSchemeMapped")
//       .lean();

//     distributors.forEach((d) => {
//       distributorCache[String(d._id)] = d.RBPSchemeMapped === "yes";
//     });
//   }

//   // Step 3: Process each distributor sequentially
//   for (let distIndex = 0; distIndex < distributorIds.length; distIndex++) {
//     const distId = distributorIds[distIndex];

//     console.log(
//       `\n[CRON] ========== Distributor ${distIndex + 1}/${
//         distributorIds.length
//       }: ${distId} ==========`
//     );

//     const distributorBillIds = billsByDistributor[distId];
//     console.log(`[CRON] ${distributorBillIds.length} bills to process`);

//     if (!summary.byDistributor[distId]) {
//       summary.byDistributor[distId] = {
//         distributorId: distId,
//         billsProcessed: 0,
//         itemsRetried: 0,
//         itemsSucceeded: 0,
//         itemsFailed: 0,
//         rewardsTransferred: 0,
//         rewardsSkippedDueToBalance: 0,
//         billsDelivered: 0,
//         billsStillPartial: 0,
//       };
//     }

//     // Get current RBP balance once per distributor (if RBP mapped)
//     let currentRBPBalance = 0;
//     const isRBPMapped = distributorCache[distId] || false;

//     if (isRBPMapped) {
//       try {
//         const lastTxn = await DistributorTransaction.findOne({
//           distributorId: distId,
//         })
//           .sort({ createdAt: -1 })
//           .select("balance")
//           .lean();

//         currentRBPBalance = lastTxn ? Number(lastTxn.balance) : 0;
//         console.log(`[CRON] Distributor RBP Balance: ${currentRBPBalance}`);
//       } catch (err) {
//         console.error(`[CRON] Failed to fetch RBP balance: ${err.message}`);
//       }
//     } else {
//       console.log(`[CRON] RBP not mapped for distributor ${distId}`);
//     }

//     // Step 4: Process bills one at a time in batches
//     for (let i = 0; i < distributorBillIds.length; i += batchSize) {
//       const batchIds = distributorBillIds.slice(i, i + batchSize);
//       const batchNumber = Math.floor(i / batchSize) + 1;
//       const totalBatches = Math.ceil(distributorBillIds.length / batchSize);

//       console.log(
//         `[CRON] Batch ${batchNumber}/${totalBatches} (${batchIds.length} bills)`
//       );

//       try {
//         // Process bills one at a time to minimize memory usage
//         for (const billId of batchIds) {
//           let bill = null;

//           try {
//             // Fetch single bill with minimal population
//             bill = await Bill.findById(billId)
//               .populate({
//                 path: "lineItems.product",
//                 select: "base_point",
//               })
//               .populate({
//                 path: "lineItems.inventoryId",
//                 select: "availableQty reservedQty",
//               })
//               .select(
//                 "_id billNo new_billno distributorId retailerId status totalBasePoints lineItems creditAmount netAmount dates adjustmentSummary"
//               );

//             if (!bill) {
//               console.log(`[CRON] Bill ${billId} not found, skipping`);
//               continue;
//             }

//             // Process the bill
//             await processSingleBillOptimized(
//               bill,
//               distId,
//               summary,
//               isRBPMapped,
//               currentRBPBalance
//             );

//             // Update balance after successful reward transfer
//             if (
//               bill.status === "Delivered" &&
//               isRBPMapped &&
//               bill.totalBasePoints > 0
//             ) {
//               currentRBPBalance = Math.max(
//                 0,
//                 currentRBPBalance - bill.totalBasePoints
//               );
//             }
//           } catch (billError) {
//             console.error(
//               `[CRON] ❌ Error processing bill ${billId}:`,
//               billError.message
//             );
//             summary.byDistributor[distId].billsStillPartial++;
//             summary.stillPartial++;
//           } finally {
//             // Aggressively clear bill data
//             if (bill) {
//               bill.lineItems = null;
//               bill = null;
//             }
//           }

//           // Micro-delay between bills
//           await new Promise((resolve) => setImmediate(resolve));
//         }

//         // Force garbage collection after each batch
//         if (global.gc) {
//           global.gc();
//         }

//         // Delay between batches
//         if (i + batchSize < distributorBillIds.length) {
//           console.log(`[CRON] Waiting 300ms before next batch...`);
//           await new Promise((resolve) => setTimeout(resolve, 300));
//         }
//       } catch (batchError) {
//         console.error(
//           `[CRON] ❌ Critical error in batch ${batchNumber}:`,
//           batchError.message
//         );

//         // Mark remaining bills in batch as failed
//         batchIds.forEach(() => {
//           summary.byDistributor[distId].billsStillPartial++;
//           summary.stillPartial++;
//         });
//       }
//     }

//     console.log(
//       `[CRON] ========== Completed Distributor: ${distId} ==========\n`
//     );

//     // Delay between distributors
//     if (distIndex < distributorIds.length - 1) {
//       await new Promise((resolve) => setTimeout(resolve, 500));
//     }
//   }

//   // Clear cache
//   Object.keys(distributorCache).forEach((key) => delete distributorCache[key]);

//   console.log("\n[CRON] ===== BILL BULK RETRY COMPLETED =====");

//   // Simplified summary logging
//   console.log(
//     `[CRON] Total: ${summary.totalBills} | Delivered: ${summary.delivered} | Partial: ${summary.stillPartial}`
//   );
//   console.log(
//     `[CRON] Items Succeeded: ${summary.itemsSucceeded} | Failed: ${summary.itemsFailed}`
//   );
//   console.log(
//     `[CRON] Rewards: ${summary.rewardsTransferred} | Skipped: ${summary.rewardsSkippedDueToBalance}`
//   );

//   // // Detailed distributor summary
//   // console.log("\n[CRON] ===== DISTRIBUTOR-WISE SUMMARY =====");
//   // Object.values(summary.byDistributor).forEach((distSummary) => {
//   //   console.log(
//   //     `[CRON] Distributor ${distSummary.distributorId}:
//   //      - Bills Processed: ${distSummary.billsProcessed}
//   //      - Delivered: ${distSummary.billsDelivered}
//   //      - Still Partial: ${distSummary.billsStillPartial}
//   //      - Items Retried: ${distSummary.itemsRetried}
//   //      - Items Succeeded: ${distSummary.itemsSucceeded}
//   //      - Items Failed: ${distSummary.itemsFailed}
//   //      - Rewards Transferred: ${distSummary.rewardsTransferred}
//   //      - Rewards Skipped (Low Balance): ${distSummary.rewardsSkippedDueToBalance}`
//   //   );
//   // });

//   console.log("\n[CRON] ===== BILL BULK RETRY ENDED =====\n");

//   return res?.status?.(200)?.json?.({
//     status: 200,
//     message: "Bulk retry completed",
//     data: summary,
//   });
// });

// module.exports = {
//   billBulkRetry,
// };
