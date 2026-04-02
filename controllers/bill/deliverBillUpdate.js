// const asyncHandler = require("express-async-handler");
// const axios = require("axios");
// const moment = require("moment-timezone");
// const {
//   updateSecondaryTargetAchievement,
// } = require("./util/updateSecondaryTargetAchievement");

// const {
//   transactionCode,
//   ledgerTransactionCode,
// } = require("../../utils/codeGenerator");
// const { calculateBackdateFields } = require("../../utils/backdateHelper");

// const Bill = require("../../models/bill.model");
// const Inventory = require("../../models/inventory.model");
// const Transaction = require("../../models/transaction.model");
// const Ledger = require("../../models/ledger.model");
// const DistributorTransaction = require("../../models/distributorTransaction.model");
// const Product = require("../../models/product.model");
// const OutletApproved = require("../../models/outletApproved.model");
// const {
//   createStockLedgerEntry,
// } = require("../../controllers/transction/createStockLedgerEntry");

// let Distributor;
// try {
//   Distributor = require("../../models/distributor.model");
// } catch {
//   Distributor = null;
// }

// const { RBP_POINT_CREDIT_API } = require("../../config/retailerApp.config");

// /* ===================== HELPERS ============================ */
// class AdjustmentError extends Error {
//   constructor(message, nonRetriable = false) {
//     super(message);
//     this.nonRetriable = !!nonRetriable;
//   }
// }

// const isNonAdjustableItem = (item) =>
//   item.itemBillType === "Item Removed" ||
//   item.itemBillType === "Stock out" ||
//   Number(item.billQty) <= 0;

// const getAdjustableItems = (bill) =>
//   bill.lineItems.filter((i) => !isNonAdjustableItem(i));

// const getDistributor = async (id) =>
//   (await OutletApproved.findById(id).lean()) ||
//   (Distributor ? await Distributor.findById(id).lean() : null);

// const isSameDistributor = (bill, userId) =>
//   String(bill.distributorId) === String(userId);

// /* =============== INVENTORY ADJUSTMENT ==================== */

// const adjustSingleLineItem = async (
//   item,
//   billId,
//   billNo,
//   userId,
//   { forceRetry = false, deliveryDate = null } = {},
// ) => {
//   if (!billId || !billNo) {
//     throw new AdjustmentError(
//       "Missing billId or billNo - cannot create transaction",
//       true,
//     );
//   }

//   const bill = await Bill.findById(billId).select("new_billno billNo").lean();
//   const finalBillNo = bill?.new_billno || bill?.billNo || billNo;

//   const productId = item.product?._id ?? item.product;
//   const invId = item.inventoryId?._id ?? item.inventoryId;
//   const lineItemId = item._id;
//   const billQty = Number(item.billQty || 0);

//   if (!productId || !invId || billQty <= 0) {
//     throw new AdjustmentError("Invalid product or quantity", true);
//   }

//   // Check using billLineItemId for precise tracking
//   // if (!forceRetry) {
//   //   // Check using billLineItemId for precise tracking (NEW FORMAT)
//   //   const alreadyAdjustedNew = await Transaction.exists({
//   //     billId: billId,
//   //     billLineItemId: lineItemId,
//   //     transactionType: "delivery",
//   //     type: "Out",
//   //   });

//   //   // Check using productId only (OLD FORMAT - for backward compatibility)
//   //   const alreadyAdjustedOld = await Transaction.exists({
//   //     billId: billId,
//   //     productId: productId,
//   //     transactionType: "delivery",
//   //     type: "Out",
//   //     billLineItemId: { $exists: false }, // Only check old format without billLineItemId
//   //   });

//   //   if ((alreadyAdjustedNew || alreadyAdjustedOld) && !forceRetry) {
//   //     const format = alreadyAdjustedNew ? "new format" : "old format";
//   //     console.log(
//   //       `✅ Product already adjusted for line item ${lineItemId} (${format})`,
//   //     );
//   //     item.adjustmentStatus = "success";
//   //     return;
//   //   }
//   // }

//   // Remove the forceRetry wrapper — always check

//   const alreadyAdjustedNew = await Transaction.exists({
//     billId: billId,
//     billLineItemId: lineItemId,
//     transactionType: "delivery",
//     type: "Out",
//   });

//   const alreadyAdjustedOld = await Transaction.exists({
//     billId: billId,
//     productId: productId,
//     transactionType: "delivery",
//     type: "Out",
//     billLineItemId: { $exists: false },
//   });

//   if (alreadyAdjustedNew || alreadyAdjustedOld) {
//     const format = alreadyAdjustedNew ? "new format" : "old format";
//     console.log(
//       `✅ Product already adjusted for line item ${lineItemId} (${format})`,
//     );
//     item.adjustmentStatus = "success";
//     return;
//   }

//   const inventory = await Inventory.findById(invId);
//   if (!inventory) throw new AdjustmentError("Inventory not found", true);

//   const reserved = Number(inventory.reservedQty || 0);
//   const available = Number(inventory.availableQty || 0);
//   const total = reserved + available;

//   if (total < billQty) {
//     throw new AdjustmentError(
//       `Insufficient stock. Available: ${total}, Required: ${billQty}`,
//       false,
//     );
//   }

//   // Check if sufficient reserved quantity exists
//   if (reserved < billQty) {
//     throw new AdjustmentError(
//       `Insufficient reserved stock. Reserved: ${reserved}, Required: ${billQty}. Total available: ${total}`,
//       false,
//     );
//   }

//   // const fromReserved = Math.min(reserved, billQty);
//   // const fromAvailable = billQty - fromReserved;

//   // making sure that the bill quantity can not be negative at any step
//   if (billQty <= 0) {
//     await createBillLog({
//       billId,
//       lineItemId,
//       event: "NEGATIVE_BILL_QTY",
//       triggeredBy: "adjustSingleLineItem",
//       beforeQty: billQty,
//       afterQty: null,
//       userId,
//       meta: { productId, invId, billNo },
//     });
//     throw new AdjustmentError(
//       `billQty is ${billQty} — refusing to deduct`,
//       true,
//     );
//   }

//   const txnId = await transactionCode("LXSTA");

//   const updated = await Inventory.findOneAndUpdate(
//     {
//       _id: invId,
//       reservedQty: { $gte: billQty },
//       // availableQty: { $gte: fromAvailable },
//     },
//     {
//       $inc: {
//         reservedQty: -billQty,
//         // availableQty: -fromAvailable,
//       },
//     },
//     { new: true, runValidators: true },
//   );

//   if (!updated) throw new AdjustmentError("Concurrent stock update", false);

//   // await Transaction.create({
//   //   distributorId: userId,
//   //   productId: productId,
//   //   invItemId: invId,
//   //   billId: billId,
//   //   billLineItemId: lineItemId, // Store line item ID
//   //   date: new Date(),
//   //   qty: billQty,
//   //   transactionId: txnId,
//   //   type: "Out",
//   //   transactionType: "delivery",
//   //   stockType: "salable",
//   //   description: `Delivered against Bill: ${finalBillNo}`,
//   // });

//   const txnDate = deliveryDate || new Date();

//   const createdTransaction = await Transaction.create({
//     distributorId: userId,
//     productId: productId,
//     invItemId: invId,
//     billId: billId,
//     billLineItemId: lineItemId,
//     date: txnDate,
//     qty: billQty,
//     transactionId: txnId,
//     type: "Out",
//     transactionType: "delivery",
//     stockType: "salable",
//     description: `Delivered against Bill: ${finalBillNo}`,
//   });

//   // Create stock ledger entry
//   try {
//     await createStockLedgerEntry(createdTransaction._id);
//   } catch (error) {
//     console.error(
//       `Stock ledger creation failed for transaction ${createdTransaction._id}:`,
//       error.message,
//     );
//     // Don't throw - allow delivery to continue even if ledger fails
//   }

//   console.log(`✅ Product adjusted successfully for line item ${lineItemId}`);

//   console.log(`✅ Product adjusted successfully for line item ${lineItemId}`);
//   item.adjustmentStatus = "success";
// };

// /* ==================== LEDGER ============================== */

// const createLedgerEntries = async (bill, userId, backdateFields) => {
//   const finalBillNo = bill.new_billno || bill.billNo;
//   const exists = await Ledger.exists({
//     billId: bill._id,
//     dbId: userId,
//     transactionFor: "Sales",
//   });
//   if (exists) return true;

//   const ledgerDate = backdateFields?.deliveryDate || new Date();

//   const creditAmount = Number(bill.creditAmount) || 0;
//   const last = await Ledger.findOne({
//     dbId: userId,
//     retailerId: bill.retailerId,
//   }).sort({ createdAt: -1 });
//   let balance = last ? Number(last.balance) : 0;

//   const txnId = await ledgerTransactionCode("LEDG", userId);
//   balance -= bill.netAmount;

//   await Ledger.create({
//     dbId: userId,
//     retailerId: bill.retailerId,
//     billId: bill._id,
//     date: ledgerDate,
//     transactionId: txnId,
//     transactionType: "debit",
//     transactionFor: "Sales",
//     transactionAmount: bill.netAmount,
//     balance,
//   });

//   await new Promise((resolve) => setTimeout(resolve, 200)); // Delay to

//   if (creditAmount > 0) {
//     const last2 = await Ledger.findOne({
//       dbId: userId,
//       retailerId: bill.retailerId,
//     }).sort({ createdAt: -1 });

//     let balance2 = last2 ? Number(last2.balance) : 0;

//     const creditTransactionId = await ledgerTransactionCode("LEDG", userId);
//     balance2 += creditAmount;

//     await Ledger.create({
//       dbId: userId,
//       retailerId: bill.retailerId,
//       billId: bill._id,
//       date: ledgerDate,
//       transactionId: creditTransactionId,
//       transactionType: "credit",
//       transactionFor: "Sales-Credit-Adjustment",
//       transactionAmount: creditAmount,
//       balance: balance2,
//     });
//   }
//   return true;
// };

// /* ==================== REWARD ============================== */

// const createSalesRewardPoints = async (bill, userId) => {
//   const finalBillNo = bill.new_billno || bill.billNo;

//   const distributor = await getDistributor(userId);
//   if (!distributor || distributor.RBPSchemeMapped !== "yes") {
//     console.log(`RBP not mapped for distributor ${userId}`);
//     return;
//   }

//   const existing = await DistributorTransaction.findOne({
//     billId: bill._id,
//     distributorId: userId,
//     transactionFor: "SALES",
//     status: "Success",
//   });

//   if (existing) {
//     console.log(`Reward already transferred for bill ${finalBillNo}`);
//     return;
//   }

//   let rewardPoints = 0;

//   /* ===== CALCULATE REWARD POINTS ===== */
//   for (const item of bill.lineItems) {
//     if (
//       item.itemBillType === "Item Removed" ||
//       item.itemBillType === "Stock out" ||
//       Number(item.billQty) <= 0
//     ) {
//       continue;
//     }

//     const delivered = await Transaction.exists({
//       billId: bill._id,
//       billLineItemId: item._id,
//       transactionType: "delivery",
//       type: "Out",
//     });

//     if (!delivered) continue;

//     const basePoint = Number(
//       item.usedBasePoint ?? item.product?.base_point ?? 0,
//     );

//     rewardPoints += basePoint * Number(item.billQty || 0);
//   }

//   if (rewardPoints == bill.totalBasePoints) {
//     rewardPoints = rewardPoints;
//   } else {
//     rewardPoints = bill.totalBasePoints;
//   }

//   if (rewardPoints <= 0) {
//     console.log(`No reward points calculated for bill ${finalBillNo}`);
//     return;
//   }

//   /* ===== RETAILER UID ===== */
//   const retailer = await OutletApproved.findById(bill.retailerId).lean();
//   if (!retailer?.outletUID) {
//     console.log(`Retailer UID missing for bill ${finalBillNo}`);
//     return;
//   }

//   /* ===== BALANCE CHECK ===== */
//   const lastTxn = await DistributorTransaction.findOne({
//     distributorId: userId,
//   }).sort({ createdAt: -1 });

//   const balance = lastTxn ? Number(lastTxn.balance) : 0;

//   if (balance < rewardPoints) {
//     console.log(
//       `⚠️ Insufficient RBP balance for Bill ${finalBillNo}: Required: ${rewardPoints}, Available: ${balance}`,
//     );

//     // Throw error without creating transaction record
//     const error = new Error("Insufficient RBP balance");
//     error.lowBalance = true;
//     error.required = rewardPoints;
//     error.available = balance;
//     error.billNo = finalBillNo;
//     throw error;
//   }
//   // await DistributorTransaction.create({
//   //   distributorId: userId,
//   //   billId: bill._id,
//   //   retailerId: bill.retailerId,
//   //   transactionType: "debit",
//   //   transactionFor: "SALES",
//   //   point: rewardPoints,
//   //   balance,
//   //   status: "Failed",
//   //   remark: `Insufficient RBP balance for Bill ${bill.billNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor.dbCode}`,
//   // });
//   // throw new Error("Insufficient RBP balance");

//   /* ===== API CALL ===== */
//   const entryDate = bill.backdateFields?.deliveryDate || new Date();
//   const res = await axios.post(RBP_POINT_CREDIT_API, {
//     distributorId: userId,
//     outlet_id: retailer.outletUID,
//     amount: rewardPoints,
//     remarks: `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor.dbCode}`,
//     type: "SALES",
//     entry_date: moment(entryDate).format("YYYY-MM-DD"),
//   });

//   if (res.data?.error) {
//     const failedTransactionData = {
//       distributorId: userId,
//       billId: bill._id,
//       retailerId: bill.retailerId,
//       transactionType: "debit",
//       transactionFor: "SALES",
//       point: rewardPoints,
//       balance,
//       status: "Failed",
//       remark: `API Error: Reward transfer failed for Bill ${finalBillNo}. Retailer UID: ${retailer.outletUID}, DB Code: ${distributor.dbCode}`,
//       apiResponse: res.data,
//     };

//     if (bill.backdateFields) {
//       failedTransactionData.dates = {
//         deliveryDate: bill.backdateFields.deliveryDate,
//         originalDeliveryDate: bill.backdateFields.originalDeliveryDate,
//       };
//       failedTransactionData.enabledBackDate =
//         bill.backdateFields.enabledBackDate;
//     }

//     await DistributorTransaction.create(failedTransactionData);
//     throw new Error("Reward API failed");
//   }

//   /* ===== SUCCESS ===== */
//   const successTransactionData = {
//     distributorId: userId,
//     billId: bill._id,
//     retailerId: bill.retailerId,
//     transactionType: "debit",
//     transactionFor: "SALES",
//     point: rewardPoints,
//     balance: balance - rewardPoints,
//     status: "Success",
//     remark: `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor.dbCode}`,
//     apiResponse: res.data,
//   };

//   if (bill.backdateFields) {
//     successTransactionData.dates = {
//       deliveryDate: bill.backdateFields.deliveryDate,
//       originalDeliveryDate: bill.backdateFields.originalDeliveryDate,
//     };
//     successTransactionData.enabledBackDate =
//       bill.backdateFields.enabledBackDate;
//     // Explicitly set timestamps for backdate
//     if (bill.backdateFields.deliveryDate) {
//       successTransactionData.createdAt = bill.backdateFields.deliveryDate;
//       successTransactionData.updatedAt = bill.backdateFields.deliveryDate;
//     }
//   }

//   await DistributorTransaction.create(successTransactionData);

//   console.log(
//     `Reward transferred successfully for bill ${finalBillNo} → ${rewardPoints} points`,
//   );
// };

// /* ==================== DELIVER ============================= */

// const deliverBillUpdate = asyncHandler(async (req, res) => {
//   const { billIds } = req.body;
//   const userId = req.user._id;

//   // Validate input
//   if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
//     return res.status(400).json({
//       error: true,
//       message: "Invalid or empty billIds array",
//     });
//   }

//   const bills = await Bill.find({
//     _id: { $in: billIds },
//     distributorId: userId,
//   }).populate("lineItems.product lineItems.inventoryId");

//   if (bills.length === 0) {
//     return res.status(404).json({
//       error: true,
//       message: "No bills found",
//     });
//   }

//   if (bills.length < billIds.length) {
//     const foundBillIds = bills.map((b) => String(b._id));
//     const unauthorizedBills = billIds.filter(
//       (id) => !foundBillIds.includes(String(id)),
//     );

//     console.warn(
//       `Distributor ${userId} attempted to access unauthorized bills: ${unauthorizedBills.join(
//         ", ",
//       )}`,
//     );
//   }

//   const results = [];
//   const errors = [];

//   for (const bill of bills) {
//     // CRITICAL VALIDATION: Check billId and billNo exist

//     const finalBillNo = bill.new_billno || bill.billNo;
//     if (!isSameDistributor(bill, userId)) {
//       errors.push({
//         billId: bill._id.toString(),
//         billNo: finalBillNo,
//         error: "Unauthorized: Bill does not belong to this distributor",
//       });
//       console.error(
//         `Distributor ${userId} tried to deliver bill ${bill.billNo} belonging to ${bill.distributorId}`,
//       );
//       continue;
//     }
//     if (!bill._id || !bill.billNo) {
//       errors.push({
//         billId: bill._id?.toString() || "UNKNOWN",
//         billNo: finalBillNo || "UNKNOWN",
//         error: "Missing billId or billNo - cannot process",
//       });
//       continue; // Skip this bill
//     }

//     const billId = String(bill._id); // Convert to string early
//     const billNo = bill.billNo;

//     const actualDeliveryDate = new Date();
//     const backdateFields = calculateBackdateFields(
//       bill.createdAt,
//       actualDeliveryDate,
//     );

//     if (backdateFields.enabledBackDate) {
//       console.log(
//         `Backdate logic applied for manually delivered bill ${billNo}: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
//       );
//     }

//     bill.backdateFields = backdateFields;

//     let adjustedCount = 0;
//     let failedCount = 0;
//     let productAdjustmentFailed = false;

//     // Process each line item
//     for (const item of bill.lineItems) {
//       if (isNonAdjustableItem(item)) continue;

//       try {
//         // Validate before processing
//         if (!item.product || !item.inventoryId) {
//           throw new AdjustmentError("Missing product or inventory data", true);
//         }

//         await adjustSingleLineItem(item, billId, billNo, userId, {
//           deliveryDate: backdateFields.deliveryDate,
//         });
//         adjustedCount++;
//       } catch (error) {
//         failedCount++;
//         productAdjustmentFailed = true;
//         item.adjustmentStatus = "failed";
//         item.adjustmentError = error.message;
//         item.adjustmentNonRetriable = error.nonRetriable || false;
//       }
//     }

//     let rewardTransferFailed = false;
//     let lowBalanceWarning = null;

//     if (!productAdjustmentFailed) {
//       // All products adjusted successfully, now create ledger
//       try {
//         await createLedgerEntries(bill, userId, bill.backdateFields);
//       } catch (error) {
//         console.error(`Ledger creation failed for ${finalBillNo}:`, error);
//       }

//       // Now attempt reward transfer
//       try {
//         await createSalesRewardPoints(bill, userId);
//       } catch (error) {
//         console.error(`Reward transfer failed for ${finalBillNo}:`, error);
//         rewardTransferFailed = true;

//         // Capture low balance warning
//         if (error.lowBalance) {
//           lowBalanceWarning = {
//             message: "Insufficient RBP balance for reward transfer",
//             required: error.required,
//             available: error.available,
//           };
//         }
//       }
//     }

//     // Check if reward was successfully transferred
//     const rewardTxn = await DistributorTransaction.exists({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     const adjustableItems = getAdjustableItems(bill);

//     // Update adjustment summary
//     bill.adjustmentSummary = {
//       totalProducts: adjustableItems.length,
//       successfulAdjustments: adjustedCount,
//       failedAdjustments: failedCount,
//       lastRetryAttempt: new Date(),
//     };

//     // Determine bill status
//     const distributor = await Distributor.findById(userId);
//     const shouldCheckReward =
//       bill.totalBasePoints > 0 && distributor?.RBPSchemeMapped === "yes";

//     if (failedCount === 0 && adjustedCount > 0) {
//       // All products adjusted successfully
//       if (shouldCheckReward) {
//         bill.status = rewardTxn ? "Delivered" : "Partially-Delivered";
//       } else {
//         bill.status = "Delivered";
//       }
//     } else if (failedCount > 0) {
//       // Some products failed
//       bill.status = "Partially-Delivered";
//     } else {
//       bill.status = "Pending";
//     }

//     bill.dates.deliveryDate = backdateFields.deliveryDate;
//     bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
//     bill.enabledBackDate = backdateFields.enabledBackDate;
//     await bill.save();
//     await updateSecondaryTargetAchievement(bill, userId);
//     console.log(
//       `Bill ${billNo} date updated to Delivered${bill.dates.deliveryDate}`,
//     );

//     results.push({
//       billNo: billNo,
//       status: bill.status,
//       adjusted: adjustedCount,
//       failed: failedCount,
//       ...(lowBalanceWarning && { warning: lowBalanceWarning }),
//     });
//   }

//   if (errors.length > 0 && results.length === 0) {
//     return res.status(400).json({
//       error: true,
//       message: "All bills failed validation - cannot process",
//       errors: errors,
//       retry: true,
//     });
//   }

//   if (errors.length > 0) {
//     return res.status(207).json({
//       error: true,
//       message: "Partial success - some bills could not be processed",
//       results: results,
//       errors: errors,
//       retry: true,
//     });
//   }

//   res.json({
//     error: false,
//     message: "Bills processed successfully",
//     results: results,
//     retry: false,
//   });
// });

// /* ==================== RETRY =============================== */
// const retryBillAdjustments = asyncHandler(async (req, res) => {
//   const { billIds } = req.body;
//   const userId = req.user._id;

//   if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
//     return res.status(400).json({
//       error: true,
//       message: "Invalid or empty billIds array",
//     });
//   }

//   const bills = await Bill.find({
//     _id: { $in: billIds },
//     distributorId: userId,
//   }).populate("lineItems.product lineItems.inventoryId");

//   if (bills.length === 0) {
//     return res.status(404).json({
//       error: true,
//       message: "No bills found",
//     });
//   }
//   if (bills.length < billIds.length) {
//     const foundBillIds = bills.map((b) => String(b._id));
//     const unauthorizedBills = billIds.filter(
//       (id) => !foundBillIds.includes(String(id)),
//     );

//     console.warn(
//       `Distributor ${userId} attempted to retry unauthorized bills: ${unauthorizedBills.join(
//         ", ",
//       )}`,
//     );
//   }

//   const results = [];
//   const errors = [];

//   for (const bill of bills) {
//     const finalBillNo = bill.new_billno || bill.billNo;
//     if (!isSameDistributor(bill, userId)) {
//       errors.push({
//         billId: bill._id.toString(),
//         billNo: finalBillNo,
//         error: "Bill does not belong to this distributor",
//       });
//       console.error(
//         `Distributor ${userId} tried to retry bill ${finalBillNo} belonging to ${bill.distributorId}`,
//       );
//       continue;
//     }
//     if (!bill._id || !bill.billNo) {
//       errors.push({
//         billId: bill._id?.toString() || "UNKNOWN",
//         billNo: finalBillNo || "UNKNOWN",
//         error: "Missing billId or billNo - cannot retry",
//       });
//       continue;
//     }

//     const billId = String(bill._id);
//     const billNo = bill.billNo;

//     const actualDeliveryDate = new Date();
//     const backdateFields = calculateBackdateFields(
//       bill.createdAt,
//       actualDeliveryDate,
//     );

//     if (backdateFields.enabledBackDate) {
//       console.log(
//         `Backdate logic applied for manually retried bill ${billNo}: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
//       );
//     }

//     bill.backdateFields = backdateFields;

//     let adjustedCount = 0;
//     let failedCount = 0;
//     let hasFailedProducts = false;

//     // STEP 1: Retry failed product adjustments (Skip Item Removed and Stock Out)
//     for (const item of bill.lineItems) {
//       if (isNonAdjustableItem(item)) {
//         console.log(
//           `Skipping non-adjustable item: ${item.product} (${item.itemBillType})`,
//         );
//         continue; // Always skip Item Removed and Stock Out
//       }

//       // Check if already successfully adjusted using Transaction table
//       const alreadyAdjusted = await Transaction.exists({
//         billId: billId,
//         billLineItemId: item._id,
//         transactionType: "delivery",
//         type: "Out",
//       });

//       if (alreadyAdjusted) {
//         item.adjustmentStatus = "success";
//         adjustedCount++;
//         continue;
//       }

//       // This item needs adjustment
//       hasFailedProducts = true;
//       try {
//         if (!item.product || !item.inventoryId) {
//           throw new AdjustmentError("Missing product or inventory data", true);
//         }

//         await adjustSingleLineItem(item, billId, billNo, userId, {
//           forceRetry: true,
//           deliveryDate: backdateFields.deliveryDate,
//         });
//         adjustedCount++;
//         hasFailedProducts = false; // This product succeeded on retry
//       } catch (error) {
//         failedCount++;
//         item.adjustmentStatus = "failed";
//         item.adjustmentError = error.message;
//         item.adjustmentAttempts = (item.adjustmentAttempts || 0) + 1;
//         item.lastAdjustmentAttempt = new Date();
//         item.adjustmentNonRetriable = error.nonRetriable || false;
//       }
//     }

//     const adjustableItems = getAdjustableItems(bill);

//     // Check if all adjustable products are actually adjusted (async check)
//     let allProductsAdjusted = true;
//     for (const item of adjustableItems) {
//       const isAdjusted = await Transaction.exists({
//         billId: billId,
//         billLineItemId: item._id,
//         transactionType: "delivery",
//         type: "Out",
//       });
//       if (!isAdjusted) {
//         allProductsAdjusted = false;
//         break;
//       }
//     }

//     // Only attempt ledger/reward if ALL adjustable products are successfully adjusted
//     let rewardSucceeded = false;
//     let lowBalanceWarning = null;

//     if (allProductsAdjusted && failedCount === 0) {
//       console.log(
//         `All products adjusted for bill ${finalBillNo}, attempting ledger and reward transfer`,
//       );

//       try {
//         await createLedgerEntries(bill, userId, bill.backdateFields);
//       } catch (error) {
//         console.error(`Ledger creation failed for ${finalBillNo}:`, error);
//       }

//       // Check if we should even attempt reward transfer
//       const distributor = await Distributor.findById(userId);
//       const shouldAttemptReward =
//         distributor?.RBPSchemeMapped === "yes" && bill.totalBasePoints > 0;

//       console.log("shouldAttemptReward", shouldAttemptReward);
//       console.log("baese points", bill.totalBasePoints);

//       if (shouldAttemptReward) {
//         console.log(`Attempting reward transfer for bill ${finalBillNo}`);
//         rewardAttempted = true;
//         try {
//           await createSalesRewardPoints(bill, userId);
//           rewardSucceeded = true;
//           console.log("Reward transfer succeeded for bill", finalBillNo);
//         } catch (error) {
//           console.error(`Reward transfer failed for ${finalBillNo}:`, error);
//           rewardSucceeded = false;

//           if (error.lowBalance) {
//             lowBalanceWarning = {
//               message: `⚠️ Low Wallet Balance: Bill ${error.billNo} requires ${error.required} points, but only ${error.available} points available. Please recharge wallet and retry.`,
//               required: error.required,
//               available: error.available,
//             };
//           }
//         }
//       } else {
//         console.log(
//           `Reward transfer not needed for bill ${finalBillNo} (RBP not mapped or no base points)`,
//         );
//         rewardSucceeded = true; // Consider it "succeeded" if not needed
//       }
//     } else {
//       console.log(
//         `Cannot attempt reward for bill ${finalBillNo}: products still failing (${failedCount} failed)`,
//       );
//     }

//     // Check final reward status from database
//     const rewardTxn = await DistributorTransaction.exists({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     // Update adjustment summary
//     bill.adjustmentSummary = {
//       totalProducts: adjustableItems.length,
//       successfulAdjustments: adjustedCount,
//       failedAdjustments: failedCount,
//       lastRetryAttempt: new Date(),
//     };

//     // Determine bill status with precise logic
//     const distributor = await Distributor.findById(userId);
//     const shouldCheckReward =
//       bill.totalBasePoints > 0 && distributor?.RBPSchemeMapped === "yes";

//     if (failedCount === 0 && adjustedCount > 0) {
//       // All adjustable products succeeded
//       if (shouldCheckReward) {
//         // RBP is mapped and bill has base points - check reward status
//         bill.status = rewardTxn ? "Delivered" : "Partially-Delivered";
//       } else {
//         // RBP not mapped or no base points - consider delivered
//         bill.status = "Delivered";
//       }
//     } else if (failedCount > 0) {
//       // Some products still failing
//       bill.status = "Partially-Delivered";
//     } else {
//       // Edge case: no adjustable items
//       bill.status = "Pending";
//     }

//     bill.dates.deliveryDate = backdateFields.deliveryDate;
//     bill.dates.originalDeliveryDate = backdateFields.originalDeliveryDate;
//     bill.enabledBackDate = backdateFields.enabledBackDate;
//     await bill.save();
//     await updateSecondaryTargetAchievement(bill, userId);
//     console.log(
//       `Bill ${finalBillNo || billNo} date updated to Delivered${
//         bill.dates.deliveryDate
//       }`,
//     );

//     results.push({
//       billNo: billNo,
//       status: bill.status,
//       adjusted: adjustedCount,
//       failed: failedCount,
//       rewardStatus: shouldCheckReward
//         ? rewardTxn
//           ? "success"
//           : "pending"
//         : "not_required",
//       ...(lowBalanceWarning && { warning: lowBalanceWarning }),
//     });
//   }

//   if (errors.length > 0 && results.length === 0) {
//     return res.status(400).json({
//       error: true,
//       message: "All bills failed validation - cannot retry",
//       errors: errors,
//       retry: true,
//     });
//   }

//   if (errors.length > 0) {
//     return res.status(207).json({
//       error: true,
//       message: "Partial success - some bills could not be retried",
//       results: results,
//       errors: errors,
//       retry: true,
//     });
//   }

//   res.json({
//     error: false,
//     message: "Retry completed successfully",
//     results: results,
//     retry: false,
//   });
// });

// /* ========================================================= */
// module.exports = {
//   deliverBillUpdate,
//   retryBillAdjustments,
//   createSalesRewardPoints,
//   createLedgerEntries,
//   adjustSingleLineItem,
// };
// console.log("Loaded deliverBillUpdate and retryBillAdjustments handlers");

//Old Code:
// const asyncHandler = require("express-async-handler");
// const axios = require("axios");
// const moment = require("moment-timezone");
// const {
//   transactionCode,
//   ledgerTransactionCode,
// } = require("../../utils/codeGenerator");

// const Bill = require("../../models/bill.model");
// const Inventory = require("../../models/inventory.model");
// const Transaction = require("../../models/transaction.model");
// const Ledger = require("../../models/ledger.model");
// const DistributorTransaction = require("../../models/distributorTransaction.model");
// const Product = require("../../models/product.model");
// const OutletApproved = require("../../models/outletApproved.model");

// const { RBP_POINT_CREDIT_API } = require("../../config/retailerApp.config");

// const deliverBillUpdate = asyncHandler(async (req, res) => {
//   try {
//     const { billIds } = req.body;

//     // ✅ Validate input
//     if (!Array.isArray(billIds) || billIds.length === 0) {
//       return res.status(400).json({
//         error: true,
//         message: "Invalid or empty billIds array",
//       });
//     }

//     if (!req.user || !req.user._id) {
//       return res.status(401).json({
//         error: true,
//         message: "Unauthorized: user not found",
//       });
//     }

//     // ✅ Remove duplicates
//     const uniqueBillIds = [...new Set(billIds)];

//     // ✅ Update bills to Delivered
//     const billStatus = await Bill.updateMany(
//       { _id: { $in: uniqueBillIds } },
//       { $set: { status: "Delivered", "dates.deliveryDate": new Date() } }
//     );

//     if (billStatus.matchedCount === 0) {
//       return res.status(404).json({
//         error: true,
//         message: "No bills found to Deliver",
//       });
//     }

//     // ✅ Fetch updated bills
//     const bills = await Bill.find({ _id: { $in: uniqueBillIds } }).populate(
//       "lineItems.product lineItems.inventoryId"
//     );

//     for (const bill of bills) {
//       if (!bill.lineItems || bill.lineItems.length === 0) continue;

//       // ---------------- INVENTORY UPDATES ----------------
//       for (const item of bill.lineItems) {
//         if (!item.inventoryId || !item.product) continue;

//         const inventory = await Inventory.findById(item.inventoryId._id);
//         if (!inventory) continue;

//         const prevAvailableQty = inventory.availableQty || 0;
//         const prevReservedQty = inventory.reservedQty || 0;
//         const totalQty = prevAvailableQty + prevReservedQty;

//         if (totalQty <= 0) continue; // avoid division by zero

//         const billQty = Number(item.billQty) || 0;
//         if (billQty <= 0) continue;

//         if (inventory.reservedQty < billQty) {
//           // Prevent negative reserved stock
//           continue;
//         }

//         const avgDlp = Math.round(inventory.totalStockamtDlp / totalQty);
//         const avgRlp = Math.round(inventory.totalStockamtRlp / totalQty);

//         inventory.reservedQty -= billQty;
//         inventory.totalStockamtDlp -= billQty * avgDlp;
//         inventory.totalStockamtRlp -= billQty * avgRlp;

//         await inventory.save();

//         const balanceCount = totalQty - billQty;

//         await Transaction.create({
//           distributorId: req.user._id,
//           productId: item.product._id,
//           invItemId: inventory._id,
//           qty: billQty,
//           transactionId: await transactionCode("LXSTA"),
//           date: new Date(),
//           type: "Out",
//           balanceCount,
//           description: `Delivered against Bill: ${bill.billNo}`,
//           transactionType: "delivery",
//           stockType: "salable",
//         });
//       }

//       // ---------------- LEDGER UPDATES ----------------
//       const creditAmount = Number(bill.creditAmount) || 0;
//       const latestLedger = await Ledger.findOne({
//         dbId: req.user._id,
//         retailerId: bill.retailerId,
//       }).sort({ createdAt: -1 });

//       let latestLedgerBalance = latestLedger ? Number(latestLedger.balance) : 0;

//       const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

//       const newBalance = latestLedgerBalance - Number(bill.netAmount);

//       await Ledger.create({
//         dbId: req.user._id,
//         retailerId: bill.retailerId,
//         transactionId,
//         transactionType: "debit",
//         transactionFor: "Sales",
//         billId: bill._id,
//         transactionAmount: Number(bill.netAmount),
//         balance: Number(newBalance.toFixed(2)),
//       });

//       // ✅ Delay to avoid race conditions
//       await new Promise((resolve) => setTimeout(resolve, 200));

//       if (creditAmount > 0) {
//         const latestLedger2 = await Ledger.findOne({
//           dbId: req.user._id,
//           retailerId: bill.retailerId,
//         }).sort({ createdAt: -1 });

//         let latestLedgerBalance2 = latestLedger2
//           ? Number(latestLedger2.balance)
//           : 0;

//         const creditTransactionId = await ledgerTransactionCode(
//           "LEDG",
//           req.user._id
//         );

//         await Ledger.create({
//           dbId: req.user._id,
//           retailerId: bill.retailerId,
//           transactionId: creditTransactionId,
//           transactionType: "credit",
//           transactionFor: "Sales-Credit-Adjustment",
//           billId: bill._id,
//           transactionAmount: creditAmount,
//           balance: Number((latestLedgerBalance2 + creditAmount).toFixed(2)),
//         });
//       }

//       // ---------------- RBP TRANSACTIONS ----------------

//       // ✅ Check if RBP scheme is mapped for the distributor
//       if (req.user.RBPSchemeMapped !== "yes") {
//         console.log(
//           `RBP scheme not mapped for distributor: ${req.user.dbCode}`
//         );
//         continue; // Skip RBP processing for this bill
//       }
//       const latestTransaction = await DistributorTransaction.findOne({
//         distributorId: req.user._id,
//       }).sort({ createdAt: -1 });

//       let latestBalance = latestTransaction ? latestTransaction.balance : 0;

//       const retailer = await OutletApproved.findById(bill.retailerId);
//       const retailerUID = retailer?.outletUID || "";
//       const dbCode = req.user.dbCode;

//       let totalRewardPoints = 0;
//       for (const item of bill.lineItems) {
//         const productData = await Product.findById(item.product);
//         if (!productData) continue;

//         const base_point = Number(productData.base_point) || 0;
//         if (base_point > 0) {
//           totalRewardPoints += base_point * (Number(item.billQty) || 0);
//         }
//       }

//       if (totalRewardPoints > 0) {
//         // ✅ Check if distributor has sufficient balance for RBP points
//         if (totalRewardPoints > latestBalance || latestBalance <= 0) {
//           console.log(
//             `Insufficient RBP balance for distributor: ${req.user.dbCode}. Required: ${totalRewardPoints}, Available: ${latestBalance}`
//           );

//           // Create a failed transaction record for insufficient balance
//           const failedTransaction = new DistributorTransaction({
//             distributorId: req.user._id,
//             transactionType: "debit",
//             transactionFor: "SALES",
//             point: totalRewardPoints,
//             balance: latestBalance, // Keep the same balance
//             billId: bill._id,
//             retailerId: bill.retailerId,
//             status: "Failed",
//             remark: `Insufficient RBP balance for Bill no ${bill.billNo}. Required: ${totalRewardPoints}, Available: ${latestBalance}`,
//             apiResponse: {
//               error: true,
//               message: "Insufficient Distributor RBP balance",
//             },
//           });

//           await failedTransaction.save();
//           continue; // Skip to next bill
//         }
//         let apiSuccess = false;
//         let apiResponse = null;

//         try {
//           const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, {
//             outlet_id: retailerUID,
//             amount: totalRewardPoints,
//             remarks: `Reward points for Bill no ${bill.billNo} for Retailer UID ${retailerUID} and DB Code ${dbCode}`,
//             type: "SALES",
//             entry_date: moment(bill.dates.deliveryDate).format("YYYY-MM-DD")
//           });

//           if (!earnPointsResponse.data?.error) {
//             apiSuccess = true;
//           } else {
//             apiResponse = earnPointsResponse.data;
//           }
//         } catch (err) {
//           apiResponse = err?.response?.data || err.message;
//         }

//         const newTransaction = new DistributorTransaction({
//           distributorId: req.user._id,
//           transactionType: "debit",
//           transactionFor: "SALES",
//           point: totalRewardPoints,
//           balance: Number(latestBalance) - totalRewardPoints,
//           billId: bill._id,
//           retailerId: bill.retailerId,
//           status: apiSuccess ? "Success" : "Failed",
//           remark: `Reward points for Bill no ${bill.billNo} for Retailer UID ${retailerUID} and DB Code ${dbCode}`,
//           apiResponse: apiSuccess ? null : apiResponse,
//         });

//         await newTransaction.save();
//       }
//     }

//     return res.status(200).json({
//       error: false,
//       message: "Bills Delivered and inventory updated successfully",
//       data: billStatus,
//     });
//   } catch (error) {
//     console.error("Deliver Bill Update Error:", error);
//     return res.status(500).json({
//       error: true,
//       message: error.message || "Internal Server Error",
//     });
//   }
// });

// module.exports = { deliverBillUpdate };
