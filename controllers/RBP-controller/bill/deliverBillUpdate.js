const asyncHandler = require("express-async-handler");

const {
  transactionCode,
  ledgerTransactionCode,
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const Bill = require("../../../models/bill.model");
const BillDeliverySetting = require("../../../models/billDeliverySetting.model");
const Inventory = require("../../../models/inventory.model");
const Transaction = require("../../../models/transaction.model");
const Ledger = require("../../../models/ledger.model");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");

const {
  createStockLedgerEntry,
} = require("../../../controllers/transction/createStockLedgerEntry");
const { calculateBackdateFields } = require("../../../utils/backdateHelper");
const { checkAndUpdatePortalLock } = require("../../../utils/checkPortalLock");
const {
  updateSecondaryTargetAchievement,
} = require("../../bill/util/updateSecondaryTargetAchievement");
const {
  validateManualDelivery,
} = require("../../../utils/manualDeliveryValidator");

let Distributor;
try {
  Distributor = require("../../../models/distributor.model");
} catch {
  Distributor = null;
}

// ======================== ERROR CLASS ========================
class AdjustmentError extends Error {
  constructor(message, nonRetriable = false) {
    super(message);
    this.nonRetriable = !!nonRetriable;
  }
}

const isDuplicateKeyError = (error) => Number(error?.code) === 11000;

// ======================== HELPER FUNCTIONS ========================
const isNonAdjustableItem = (item) =>
  item.itemBillType === "Item Removed" ||
  item.itemBillType === "Stock out" ||
  Number(item.billQty) <= 0;

const getAdjustableItems = (bill) =>
  (bill.lineItems || []).filter((i) => !isNonAdjustableItem(i));

const isSameDistributor = (bill, userId) =>
  String(bill.distributorId) === String(userId);

const getDistributorProfile = async (userId) => {
  if (!Distributor) return null;
  return Distributor.findById(userId).lean();
};

const buildBackdateFields = (
  bill,
  enableBackdateBilling,
  actualDeliveryDate,
) => {
  const billingDate = bill.createdAt;
  return calculateBackdateFields(
    billingDate,
    actualDeliveryDate,
    enableBackdateBilling,
  );
};

const resolveEffectiveBackdateFields = (
  bill,
  candidateBackdateFields,
  fallbackDate = new Date(),
) => {
  if (candidateBackdateFields?.deliveryDate) {
    return {
      deliveryDate: candidateBackdateFields.deliveryDate,
      originalDeliveryDate:
        candidateBackdateFields.originalDeliveryDate ||
        candidateBackdateFields.deliveryDate,
      enabledBackDate: candidateBackdateFields.enabledBackDate === true,
    };
  }

  if (bill?.backdateFields?.deliveryDate) {
    return {
      deliveryDate: bill.backdateFields.deliveryDate,
      originalDeliveryDate:
        bill.backdateFields.originalDeliveryDate ||
        bill.backdateFields.deliveryDate,
      enabledBackDate: bill.backdateFields.enabledBackDate === true,
    };
  }

  if (bill?.dates?.deliveryDate) {
    return {
      deliveryDate: bill.dates.deliveryDate,
      originalDeliveryDate:
        bill.dates.originalDeliveryDate || bill.dates.deliveryDate,
      enabledBackDate: bill.enabledBackDate === true,
    };
  }

  return {
    deliveryDate: fallbackDate,
    originalDeliveryDate: fallbackDate,
    enabledBackDate: false,
  };
};

// ======================== STEP 1: INVENTORY ADJUSTMENT ========================
const adjustSingleLineItem = async (
  item,
  billId,
  billNo,
  userId,
  { forceRetry = false, deliveryDate = null, backdateFields = null } = {},
) => {
  const productId = item.product?._id ?? item.product;
  const invId = item.inventoryId?._id ?? item.inventoryId;
  const lineItemId = item._id;
  const billQty = Number(item.billQty || 0);

  if (!billId || !billNo) {
    throw new AdjustmentError("Missing billId or billNo", true);
  }

  if (!productId || !invId || billQty <= 0) {
    throw new AdjustmentError("Invalid product or quantity", true);
  }

  // Check if already adjusted - support both new format (with billLineItemId) and old format (without)
  const alreadyAdjustedNew = await Transaction.exists({
    billId,
    billLineItemId: lineItemId,
    transactionType: "delivery",
    type: "Out",
  });

  const alreadyAdjustedOld = await Transaction.exists({
    billId,
    productId: productId,
    transactionType: "delivery",
    type: "Out",
    billLineItemId: { $exists: false },
  });

  if (alreadyAdjustedNew || alreadyAdjustedOld) {
    item.adjustmentStatus = "success";
    return true;
  }

  // Validate inventory
  const inventory = await Inventory.findById(invId).select(
    "reservedQty availableQty",
  );
  if (!inventory) throw new AdjustmentError("Inventory not found", true);

  const reserved = Number(inventory.reservedQty || 0);
  if (reserved < billQty) {
    throw new AdjustmentError(
      `Insufficient reserved stock. Reserved: ${reserved}, Required: ${billQty}`,
      false,
    );
  }

  // Atomic inventory decrement
  const updated = await Inventory.findOneAndUpdate(
    { _id: invId, reservedQty: { $gte: billQty } },
    { $inc: { reservedQty: -billQty } },
    { new: true },
  );

  if (!updated) throw new AdjustmentError("Concurrent stock update", false);

  // Create transaction
  const txnId = await transactionCode("LXSTA");
  const txnDate = deliveryDate || new Date();

  const transactionData = {
    distributorId: userId,
    productId,
    invItemId: invId,
    billId,
    billLineItemId: lineItemId,
    date: txnDate,
    qty: billQty,
    transactionId: txnId,
    type: "Out",
    transactionType: "delivery",
    stockType: "salable",
    description: `Delivered against Bill ${billNo}`,
  };

  if (backdateFields) {
    transactionData.date = backdateFields.deliveryDate || txnDate;
    transactionData.dates = {
      deliveryDate: backdateFields.deliveryDate || null,
      originalDeliveryDate: backdateFields.originalDeliveryDate || null,
    };
    transactionData.enabledBackDate = backdateFields.enabledBackDate;
    if (backdateFields.deliveryDate) {
      transactionData.createdAt = backdateFields.deliveryDate;
      transactionData.updatedAt = backdateFields.deliveryDate;
    }
  }

  // Validate required fields before creating transaction
  if (
    !transactionData.type ||
    !transactionData.date ||
    !transactionData.qty ||
    !transactionData.invItemId
  ) {
    throw new AdjustmentError(
      `Transaction validation failed - Missing required fields. type: ${transactionData.type}, date: ${transactionData.date}, qty: ${transactionData.qty}, invItemId: ${transactionData.invItemId}`,
      true,
    );
  }

  let createdTransaction;
  try {
    createdTransaction = await Transaction.create(transactionData);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Another request already created the same delivery transaction.
      await Inventory.updateOne(
        { _id: invId },
        { $inc: { reservedQty: billQty } },
      );
      item.adjustmentStatus = "success";
      return true;
    }
    throw error;
  }

  // Create stock ledger entry (non-blocking)
  try {
    await createStockLedgerEntry(createdTransaction._id);
  } catch (ledgerError) {
    console.error(`Stock ledger failed for txn ${txnId}:`, ledgerError.message);
  }

  item.adjustmentStatus = "success";
  return true;
};

// ======================== STEP 2: LEDGER ENTRIES ========================
const createLedgerEntries = async (bill, userId, backdateFields) => {
  const exists = await Ledger.exists({
    billId: bill._id,
    dbId: userId,
    retailerId: bill.retailerId,
    transactionFor: "Sales",
  });

  if (exists) return true;

  const effectiveBackdate = resolveEffectiveBackdateFields(
    bill,
    backdateFields,
    new Date(),
  );
  const ledgerDate = effectiveBackdate.deliveryDate || new Date();
  const creditAmount = Number(bill.creditAmount) || 0;
  const netAmount = Number(bill.netAmount) || 0;

  // Get last balance
  const last = await Ledger.findOne({
    dbId: userId,
    retailerId: bill.retailerId,
  })
    .sort({ createdAt: -1 })
    .select("balance")
    .lean();

  const currentBalance = last ? Number(last.balance) : 0;

  // Create debit entry
  const txnId = await ledgerTransactionCode("LEDG", userId);
  const ledgerDebitData = {
    dbId: userId,
    retailerId: bill.retailerId,
    billId: bill._id,
    date: ledgerDate,
    transactionId: txnId,
    transactionType: "debit",
    transactionFor: "Sales",
    transactionAmount: netAmount,
    balance: currentBalance - netAmount,
  };

  if (ledgerDate) {
    ledgerDebitData.createdAt = ledgerDate;
    ledgerDebitData.updatedAt = ledgerDate;
  }

  await Ledger.create(ledgerDebitData);

  // Delay to ensure proper sequencing of ledger entries
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Create credit entry if applicable
  if (creditAmount > 0) {
    const last2 = await Ledger.findOne({
      dbId: userId,
      retailerId: bill.retailerId,
    })
      .sort({ createdAt: -1 })
      .select("balance")
      .lean();

    const balance2 = last2 ? Number(last2.balance) : 0;
    const creditTxnId = await ledgerTransactionCode("LEDG", userId);

    const ledgerCreditData = {
      dbId: userId,
      retailerId: bill.retailerId,
      billId: bill._id,
      date: ledgerDate,
      transactionId: creditTxnId,
      transactionType: "credit",
      transactionFor: "Sales-Credit-Adjustment",
      transactionAmount: creditAmount,
      balance: balance2 + creditAmount,
    };

    if (ledgerDate) {
      ledgerCreditData.createdAt = ledgerDate;
      ledgerCreditData.updatedAt = ledgerDate;
    }

    await Ledger.create(ledgerCreditData);
  }

  return true;
};

// ======================== STEP 3: RBP REWARDS ========================
const calculateRewardPoints = (bill) => {
  let rewardPoints = 0;

  for (const item of bill.lineItems || []) {
    if (isNonAdjustableItem(item)) continue;
    const basePoint = Number(
      item.usedBasePoint ?? item.product?.base_point ?? 0,
    );
    rewardPoints += basePoint * Number(item.billQty || 0);
  }

  const expected = Number(bill.totalBasePoints || 0);
  return rewardPoints !== expected ? expected : rewardPoints;
};

const verifyInventoryComplete = async (bill) => {
  const adjustableItems = getAdjustableItems(bill);

  for (const item of adjustableItems) {
    const exists = await Transaction.exists({
      billId: bill._id,
      billLineItemId: item._id,
      transactionType: "delivery",
      type: "Out",
    });

    if (!exists) {
      throw new Error("Inventory transactions incomplete");
    }
  }

  return true;
};

const createDistributorRewardTransaction = async (
  bill,
  userId,
  rewardPoints,
  distributor,
  retailer,
) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  // Check if already exists
  const existing = await DistributorTransaction.findOne({
    billId: bill._id,
    distributorId: userId,
    retailerId: bill.retailerId,
    transactionFor: "SALES",
    status: "Success",
  });

  if (existing) return existing;

  // Get last balance
  const lastTxn = await DistributorTransaction.findOne({
    distributorId: userId,
  })
    .sort({ createdAt: -1 })
    .select("balance")
    .lean();

  const balance = lastTxn ? Number(lastTxn.balance) : 0;

  const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor?.dbCode || "N/A"}`;

  const txnData = {
    distributorId: userId,
    billId: bill._id,
    retailerId: bill.retailerId,
    transactionType: "debit",
    transactionFor: "SALES",
    point: rewardPoints,
    balance: balance - rewardPoints,
    status: "Success",
    remark: remarkText,
  };

  const effectiveBackdate = resolveEffectiveBackdateFields(
    bill,
    bill.backdateFields,
    new Date(),
  );
  if (effectiveBackdate?.deliveryDate) {
    txnData.dates = {
      deliveryDate: effectiveBackdate.deliveryDate,
      originalDeliveryDate: effectiveBackdate.originalDeliveryDate,
    };
    txnData.enabledBackDate = effectiveBackdate.enabledBackDate;
    txnData.createdAt = effectiveBackdate.deliveryDate;
    txnData.updatedAt = effectiveBackdate.deliveryDate;
  }

  try {
    return await DistributorTransaction.create(txnData);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return DistributorTransaction.findOne({
      billId: bill._id,
      distributorId: userId,
      retailerId: bill.retailerId,
      transactionFor: "SALES",
      status: "Success",
    });
  }
};

const createRetailerRewardTransaction = async (
  bill,
  userId,
  rewardPoints,
  distributorTransaction,
  distributor,
  retailer,
) => {
  const finalBillNo = bill.new_billno || bill.billNo;

  // Check if already exists
  const existing = await RetailerOutletTransaction.findOne({
    billId: bill._id,
    distributorId: userId,
    retailerId: bill.retailerId,
    transactionFor: "SALES",
    status: "Success",
  });

  if (existing) return existing;

  if (!distributorTransaction) {
    throw new Error("Distributor transaction required for retailer reward");
  }

  const dist = distributor || (await getDistributorProfile(userId));
  const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${dist?.dbCode || "N/A"}`;

  // Get last balance
  const lastTxn = await RetailerOutletTransaction.findOne({
    retailerId: bill.retailerId,
    distributorId: userId,
  })
    .sort({ createdAt: -1 })
    .select("balance")
    .lean();

  const balance = lastTxn
    ? Number(lastTxn.balance)
    : Number(retailer.currentPointBalance) || 0;

  const txnData = {
    retailerId: bill.retailerId,
    distributorId: userId,
    billId: bill._id,
    transactionId: await retailerOutletTransactionCode("RTO"),
    distributorTransactionId: distributorTransaction._id,
    transactionType: "credit",
    transactionFor: "SALES",
    point: rewardPoints,
    balance: balance + rewardPoints,
    status: "Success",
    remark: remarkText,
  };

  const effectiveBackdate = resolveEffectiveBackdateFields(
    bill,
    bill.backdateFields,
    new Date(),
  );
  if (effectiveBackdate?.deliveryDate) {
    txnData.dates = {
      deliveryDate: effectiveBackdate.deliveryDate,
      originalDeliveryDate: effectiveBackdate.originalDeliveryDate,
    };
    txnData.enabledBackDate = effectiveBackdate.enabledBackDate;
    txnData.createdAt = effectiveBackdate.deliveryDate;
    txnData.updatedAt = effectiveBackdate.deliveryDate;
  }

  let retailerTxn;
  try {
    retailerTxn = await RetailerOutletTransaction.create(txnData);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return RetailerOutletTransaction.findOne({
      billId: bill._id,
      distributorId: userId,
      retailerId: bill.retailerId,
      transactionFor: "SALES",
      status: "Success",
    });
  }

  // Link back to distributor transaction
  await DistributorTransaction.updateOne(
    { _id: distributorTransaction._id },
    { $set: { retailerOutletTransactionId: retailerTxn._id } },
  );

  // Update retailer balance
  await OutletApproved.updateOne(
    { _id: bill.retailerId },
    { $inc: { currentPointBalance: rewardPoints } },
  );

  return retailerTxn;
};

const createSalesRewardPoints = async (bill, userId, distributorProfile) => {
  if (!distributorProfile || distributorProfile.RBPSchemeMapped !== "yes") {
    return { distributorTxn: null, retailerTxn: null, skipped: true };
  }

  // Verify all inventory transactions are complete
  await verifyInventoryComplete(bill);

  const retailer = await OutletApproved.findById(bill.retailerId).lean();
  if (!retailer?.outletUID) {
    throw new Error("Retailer UID missing");
  }

  const rewardPoints = calculateRewardPoints(bill);
  if (rewardPoints <= 0) {
    return { distributorTxn: null, retailerTxn: null, skipped: true };
  }

  const distributorTxn = await createDistributorRewardTransaction(
    bill,
    userId,
    rewardPoints,
    distributorProfile,
    retailer,
  );

  const retailerTxn = await createRetailerRewardTransaction(
    bill,
    userId,
    rewardPoints,
    distributorTxn,
    distributorProfile,
    retailer,
  );

  return { distributorTxn, retailerTxn, skipped: false };
};

// ======================== FINALIZE BILL ========================
const finalizeBill = async (
  bill,
  {
    adjustedCount,
    failedCount,
    totalProducts,
    shouldCheckReward,
    distributorRewardSuccess,
    retailerRewardSuccess,
    actualDeliveryDate,
  },
) => {
  bill.adjustmentSummary = {
    totalProducts: totalProducts,
    successfulAdjustments: adjustedCount,
    failedAdjustments: failedCount,
    lastRetryAttempt: new Date(),
  };

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

  // Set delivery dates
  if (bill.backdateFields) {
    bill.dates.deliveryDate = bill.backdateFields.deliveryDate;
    bill.dates.originalDeliveryDate = bill.backdateFields.originalDeliveryDate;
    bill.enabledBackDate = bill.backdateFields.enabledBackDate;
  } else {
    bill.dates.deliveryDate = actualDeliveryDate;
  }

  // Clean up invalid goodsType values before saving
  // goodsType must be either "Billed", "Replacement", or undefined - not empty string
  for (const item of bill.lineItems || []) {
    if (item.goodsType === "" || item.goodsType === null) {
      // Set to undefined to allow Mongoose to handle it properly
      item.goodsType = undefined;
    }
  }

  // Mark lineItems as modified so Mongoose saves the adjustmentStatus changes
  bill.markModified("lineItems");

  await bill.save();
};

// ======================== MAIN PROCESS BILL ========================
const processSingleBill = async (
  bill,
  userId,
  { enableBackdateBilling, distributorProfile, forceRetry },
) => {
  const billId = String(bill._id);
  const billNo = bill.new_billno || bill.billNo; //added the new bill no field if it is there then use that else use the old bill no
  const actualDeliveryDate = new Date();

  // Setup backdate fields
  const backdateFields = buildBackdateFields(
    bill,
    enableBackdateBilling,
    actualDeliveryDate,
  );
  bill.backdateFields = backdateFields;

  let adjustedCount = 0;
  let failedCount = 0;
  let inventoryStepSuccess = true;
  let ledgerStepSuccess = false;
  let distributorRewardSuccess = false;
  let retailerRewardSuccess = false;

  const adjustableItems = getAdjustableItems(bill);

  // STEP 1: Inventory Adjustments
  for (const item of adjustableItems) {
    try {
      if (!item.product || !item.inventoryId) {
        throw new AdjustmentError("Missing product or inventory data", true);
      }

      await adjustSingleLineItem(item, billId, billNo, userId, {
        forceRetry,
        deliveryDate: backdateFields.deliveryDate,
        backdateFields,
      });
      adjustedCount++;
    } catch (error) {
      failedCount++;
      inventoryStepSuccess = false;
      item.adjustmentStatus = "failed";
      item.adjustmentError = error.message;
      item.adjustmentNonRetriable = error.nonRetriable || false;
      if (forceRetry) {
        item.adjustmentAttempts = (item.adjustmentAttempts || 0) + 1;
        item.lastAdjustmentAttempt = new Date();
      }
    }
  }

  // STEP 2: Ledger Entries (only if inventory succeeded)
  if (inventoryStepSuccess) {
    try {
      ledgerStepSuccess = await createLedgerEntries(
        bill,
        userId,
        backdateFields,
      );
    } catch (error) {
      console.error(`Ledger creation failed:`, error.message);
      ledgerStepSuccess = false;
    }
  }

  const shouldCheckReward =
    bill.totalBasePoints > 0 && distributorProfile?.RBPSchemeMapped === "yes";

  // STEP 3: RBP Rewards (only if inventory AND ledger succeeded)
  if (inventoryStepSuccess && ledgerStepSuccess && shouldCheckReward) {
    try {
      const { distributorTxn, retailerTxn } = await createSalesRewardPoints(
        bill,
        userId,
        distributorProfile,
      );
      distributorRewardSuccess = !!distributorTxn;
      retailerRewardSuccess = !!retailerTxn;
    } catch (error) {
      console.error(`RBP reward failed:`, error.message);
      distributorRewardSuccess = false;
      retailerRewardSuccess = false;
    }
  }

  // If RBP not required, mark as success
  if (inventoryStepSuccess && ledgerStepSuccess && !shouldCheckReward) {
    distributorRewardSuccess = true;
    retailerRewardSuccess = true;
  }

  // Finalize bill
  await finalizeBill(bill, {
    adjustedCount,
    failedCount,
    totalProducts: adjustableItems.length,
    shouldCheckReward,
    distributorRewardSuccess,
    retailerRewardSuccess,
    actualDeliveryDate,
  });

  await updateSecondaryTargetAchievement(bill, userId);

  try {
    await checkAndUpdatePortalLock(userId);
  } catch (lockError) {
    console.error("Portal lock check failed:", lockError.message);
  }

  return {
    billNo,
    status: bill.status,
    adjusted: adjustedCount,
    failed: failedCount,
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
  };
};

// ======================== DELIVER BILL UPDATE ========================
const deliverBillUpdate = asyncHandler(async (req, res) => {
  const { billIds } = req.body;
  const userId = req.user._id;

  if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
    return res.status(400).json({
      error: true,
      message: "Invalid or empty billIds array",
    });
  }

  // Validate manual delivery permission
  const manualDeliveryValidation = await validateManualDelivery(userId);
  if (!manualDeliveryValidation.allowed) {
    return res.status(403).json({
      error: true,
      message: manualDeliveryValidation.reason,
      data: {
        enableBackdateBilling:
          manualDeliveryValidation.setting?.enableBackdateBilling || false,
        setting: manualDeliveryValidation.setting,
      },
    });
  }

  // Fetch distributor profile once
  const distributorProfile = await getDistributorProfile(userId);

  // Fetch bills
  const bills = await Bill.find({
    _id: { $in: billIds },
    distributorId: userId,
  }).populate("lineItems.product lineItems.inventoryId orderId");

  if (bills.length === 0) {
    return res.status(404).json({
      error: true,
      message: "No bills found",
    });
  }

  const results = [];
  const errors = [];

  for (const bill of bills) {
    const finalBillNo = bill.new_billno || bill.billNo;

    // Validate authorization
    if (!isSameDistributor(bill, userId)) {
      errors.push({
        billId: String(bill._id),
        billNo: finalBillNo,
        error: "Unauthorized: Bill does not belong to this distributor",
      });
      continue;
    }

    if (!bill._id || !bill.billNo) {
      errors.push({
        billId: bill._id?.toString() || "UNKNOWN",
        billNo: bill.billNo || "UNKNOWN",
        error: "Missing billId or billNo",
      });
      continue;
    }

    try {
      const result = await processSingleBill(bill, userId, {
        enableBackdateBilling:
          manualDeliveryValidation.setting?.enableBackdateBilling === true,
        distributorProfile,
        forceRetry: false,
      });
      results.push(result);
    } catch (error) {
      errors.push({
        billId: String(bill._id),
        billNo: finalBillNo,
        error: error.message,
      });
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return res.status(400).json({
      error: true,
      message: "All bills failed validation",
      errors,
      retry: true,
    });
  }

  if (errors.length > 0) {
    return res.status(207).json({
      error: true,
      message: "Partial success",
      results,
      errors,
      retry: true,
    });
  }

  return res.json({
    error: false,
    message: "Bills processed successfully",
    results,
    retry: false,
  });
});

// ======================== RETRY BILL ADJUSTMENTS ========================
const retryBillAdjustments = asyncHandler(async (req, res) => {
  const { billIds } = req.body;
  const userId = req.user._id;

  if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
    return res.status(400).json({
      error: true,
      message: "Invalid or empty billIds array",
    });
  }

  const bills = await Bill.find({
    _id: { $in: billIds },
    distributorId: userId,
  }).populate("lineItems.product lineItems.inventoryId orderId");

  if (bills.length === 0) {
    return res.status(404).json({
      error: true,
      message: "No bills found",
    });
  }

  const deliverySetting = await BillDeliverySetting.findOne({
    distributorId: userId,
  });

  const distributorProfile = await getDistributorProfile(userId);
  const enableBackdateBilling = deliverySetting?.enableBackdateBilling === true;

  const results = [];
  const errors = [];

  for (const bill of bills) {
    const finalBillNo = bill.new_billno || bill.billNo;

    if (!isSameDistributor(bill, userId)) {
      errors.push({
        billId: String(bill._id),
        billNo: finalBillNo,
        error: "Bill does not belong to this distributor",
      });
      continue;
    }

    if (!bill._id || !bill.billNo) {
      errors.push({
        billId: bill._id?.toString() || "UNKNOWN",
        billNo: bill.billNo || "UNKNOWN",
        error: "Missing billId or billNo",
      });
      continue;
    }

    try {
      const result = await processSingleBill(bill, userId, {
        enableBackdateBilling,
        distributorProfile,
        forceRetry: true,
      });

      results.push({
        billNo: result.billNo,
        status: result.status,
        adjusted: result.adjusted,
        failed: result.failed,
        rewardStatus: result.distributorReward,
        retailerReward: result.retailerReward,
      });
    } catch (error) {
      errors.push({
        billId: String(bill._id),
        billNo: finalBillNo,
        error: error.message,
      });
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return res.status(400).json({
      error: true,
      message: "All retry attempts failed",
      errors,
      retry: true,
    });
  }

  if (errors.length > 0) {
    return res.status(207).json({
      error: true,
      message: "Partial retry success",
      results,
      errors,
      retry: true,
    });
  }

  return res.json({
    error: false,
    message: "Retry completed successfully",
    results,
    retry: false,
  });
});

// ======================== EXPORTS ========================
module.exports = {
  deliverBillUpdate,
  retryBillAdjustments,
  createSalesRewardPoints,
  createLedgerEntries,
  adjustSingleLineItem,
  createDistributorRewardTransaction,
  createRetailerRewardTransaction,
};

// ======================== OLD CODE BELOW (COMMENTED FOR REFERENCE) ========================

// 2nd Old Code
// const asyncHandler = require("express-async-handler");
// const axios = require("axios");
// const moment = require("moment-timezone");
// const mongoose = require("mongoose");

// const {
//   transactionCode,
//   ledgerTransactionCode,
//   retailerOutletTransactionCode,
// } = require("../../../utils/codeGenerator");

// const Bill = require("../../../models/bill.model");
// const BillDeliverySetting = require("../../../models/billDeliverySetting.model");
// const Inventory = require("../../../models/inventory.model");
// const Transaction = require("../../../models/transaction.model");
// const Ledger = require("../../../models/ledger.model");
// const DistributorTransaction = require("../../../models/distributorTransaction.model");
// const Product = require("../../../models/product.model");
// const OutletApproved = require("../../../models/outletApproved.model");
// const {
//   createStockLedgerEntry,
// } = require("../../../controllers/transction/createStockLedgerEntry");
// const { calculateBackdateFields } = require("../../../utils/backdateHelper");

// // ============ BILL DELIVERY PORTAL LOCK UTILITY ============
// const { checkAndUpdatePortalLock } = require("../../../utils/checkPortalLock");

// let Distributor;
// try {
//   Distributor = require("../../../models/distributor.model");
// } catch {
//   Distributor = null;
// }

// const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");

// const {
//   updateSecondaryTargetAchievement,
// } = require("../../bill/util/updateSecondaryTargetAchievement");

// // ============ MANUAL DELIVERY VALIDATION ============
// const {
//   validateManualDelivery,
//   validateBillManualDelivery,
// } = require("../../../utils/manualDeliveryValidator");

// const today = new Date();
// console.log(today);

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
//   { forceRetry = false, deliveryDate = null, backdateFields = null } = {},
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
//   if (!forceRetry) {
//     const alreadyAdjustedNew = await Transaction.exists({
//       billId: billId,
//       billLineItemId: lineItemId,
//       transactionType: "delivery",
//       type: "Out",
//     });

//     const alreadyAdjustedOld = await Transaction.exists({
//       billId: billId,
//       productId: productId,
//       transactionType: "delivery",
//       type: "Out",
//       billLineItemId: { $exists: false },
//     });

//     if ((alreadyAdjustedNew || alreadyAdjustedOld) && !forceRetry) {
//       const format = alreadyAdjustedNew ? "new format" : "old format";
//       console.log(
//         `✅ Product already adjusted for line item ${lineItemId} (${format})`,
//       );
//       item.adjustmentStatus = "success";
//       return;
//     }
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
//     { new: true },
//   );

//   if (!updated) throw new AdjustmentError("Concurrent stock update", false);

//   // await Transaction.create({
//   //   distributorId: userId,
//   //   productId: productId,
//   //   invItemId: invId,
//   //   billId: billId,
//   //   billLineItemId: lineItemId,
//   //   date: new Date(),
//   //   qty: billQty,
//   //   transactionId: txnId,
//   //   type: "Out",
//   //   transactionType: "delivery",
//   //   stockType: "salable",
//   //   description: `Delivered against Bill ${billNo}`,
//   // });

//   const txnDate = deliveryDate || new Date();

//   const transactionData = {
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
//     description: `Delivered against Bill ${billNo}`,
//   };

//   if (backdateFields) {
//     transactionData.date = backdateFields.deliveryDate || txnDate;
//     transactionData.dates = {
//       deliveryDate: backdateFields.deliveryDate || null,
//       originalDeliveryDate: backdateFields.originalDeliveryDate || null,
//     };
//     transactionData.enabledBackDate = backdateFields.enabledBackDate;
//     // Explicitly set timestamps for backdate
//     if (backdateFields.deliveryDate) {
//       transactionData.createdAt = backdateFields.deliveryDate;
//       transactionData.updatedAt = backdateFields.deliveryDate;
//     }
//   }

//   await Transaction.create(transactionData);

//   // **NEW: Create stock ledger entry**
//   try {
//     // const {
//     //   createStockLedgerEntry,
//     // } = require("../../../utils/stockLedger.helper");
//     const createdTransaction = await Transaction.findOne({
//       transactionId: txnId,
//       billLineItemId: lineItemId,
//     }).lean();

//     if (createdTransaction) {
//       await createStockLedgerEntry(createdTransaction._id);
//     }
//   } catch (ledgerError) {
//     console.error(
//       `Stock ledger creation failed for transaction ${txnId}:`,
//       ledgerError.message,
//     );
//   }

//   console.log(`✅ Product adjusted successfully for line item ${lineItemId}`);
//   // console.log(`✅ Product adjusted successfully for line item ${lineItemId}`);
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

//   const ledgerDebitData = {
//     dbId: userId,
//     retailerId: bill.retailerId,
//     billId: bill._id,
//     date: ledgerDate,
//     transactionId: txnId,
//     transactionType: "debit",
//     transactionFor: "Sales",
//     transactionAmount: bill.netAmount,
//     balance,
//   };

//   // Explicitly set timestamps for backdate
//   if (ledgerDate) {
//     ledgerDebitData.createdAt = ledgerDate;
//     ledgerDebitData.updatedAt = ledgerDate;
//   }

//   await Ledger.create(ledgerDebitData);

//   await new Promise((resolve) => setTimeout(resolve, 200)); // Delay to

//   if (creditAmount > 0) {
//     const last2 = await Ledger.findOne({
//       dbId: userId,
//       retailerId: bill.retailerId,
//     }).sort({ createdAt: -1 });

//     let balance2 = last2 ? Number(last2.balance) : 0;

//     const creditTransactionId = await ledgerTransactionCode("LEDG", userId);
//     balance2 += creditAmount;

//     const ledgerCreditData = {
//       dbId: userId,
//       retailerId: bill.retailerId,
//       billId: bill._id,
//       date: ledgerDate,
//       transactionId: creditTransactionId,
//       transactionType: "credit",
//       transactionFor: "Sales-Credit-Adjustment",
//       transactionAmount: creditAmount,
//       balance: balance2,
//     };

//     // Explicitly set timestamps for backdate
//     if (ledgerDate) {
//       ledgerCreditData.createdAt = ledgerDate;
//       ledgerCreditData.updatedAt = ledgerDate;
//     }

//     await Ledger.create(ledgerCreditData);
//   }

//   return true;
// };

// /* =================== REWARD - DISTRIBUTOR ================ */

// const createDistributorRewardTransaction = async (
//   bill,
//   userId,
//   rewardPoints,
//   distributor,
// ) => {
//   const finalBillNo = bill.new_billno || bill.billNo;

//   // Check if distributor transaction already exists
//   const existingDistributorTxn = await DistributorTransaction.findOne({
//     billId: bill._id,
//     distributorId: userId,
//     transactionFor: "SALES",
//     status: "Success",
//   });

//   if (existingDistributorTxn) {
//     console.log(
//       `Distributor reward already transferred for bill ${finalBillNo}`,
//     );
//     return existingDistributorTxn;
//   }

//   // Fetch retailer
//   const retailer = await OutletApproved.findById(bill.retailerId).lean();
//   if (!retailer?.outletUID) {
//     console.log(`Retailer UID missing for bill ${finalBillNo}`);
//     return null;
//   }

//   // Check distributor balance
//   const lastDistributorTxn = await DistributorTransaction.findOne({
//     distributorId: userId,
//   }).sort({ createdAt: -1 });

//   const distributorBalance = lastDistributorTxn
//     ? Number(lastDistributorTxn.balance)
//     : 0;

//   // if (distributorBalance < rewardPoints) {
//   //   console.log(
//   //     `Insufficient RBP balance for Bill ${finalBillNo}: Required: ${rewardPoints}, Available: ${distributorBalance}`,
//   //   );
//   //   const error = new Error("Insufficient RBP balance");
//   //   error.lowBalance = true;
//   //   error.required = rewardPoints;
//   //   error.available = distributorBalance;
//   //   error.billNo = finalBillNo;
//   //   throw error;
//   // }

//   const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${retailer.outletUID} and DB Code ${distributor.dbCode}`;

//   // Create distributor transaction with backdate fields if applicable
//   const distributorTransactionData = {
//     distributorId: userId,
//     billId: bill._id,
//     retailerId: bill.retailerId,
//     transactionType: "debit",
//     transactionFor: "SALES",
//     point: rewardPoints,
//     balance: distributorBalance - rewardPoints,
//     status: "Success",
//     remark: remarkText,
//   };

//   // Add backdate fields if they exist on bill
//   if (bill.backdateFields) {
//     distributorTransactionData.dates = {
//       deliveryDate: bill.backdateFields.deliveryDate,
//       originalDeliveryDate: bill.backdateFields.originalDeliveryDate,
//     };
//     distributorTransactionData.enabledBackDate =
//       bill.backdateFields.enabledBackDate;
//     // Set timestamps for backdate
//     if (bill.backdateFields.deliveryDate) {
//       distributorTransactionData.createdAt = bill.backdateFields.deliveryDate;
//       distributorTransactionData.updatedAt = bill.backdateFields.deliveryDate;
//     }
//   }

//   const distributorTransaction = await DistributorTransaction.create(
//     distributorTransactionData,
//   );

//   console.log(
//     `Distributor reward transferred for bill ${finalBillNo} → ${rewardPoints} points`,
//   );

//   return distributorTransaction;
// };

// /* ==================== REWARD - RETAILER =================== */

// const createRetailerRewardTransaction = async (
//   bill,
//   userId,
//   rewardPoints,
//   distributorTransaction,
//   distributor,
// ) => {
//   const finalBillNo = bill.new_billno || bill.billNo;

//   // Check if retailer transaction already exists
//   const existingRetailerTxn = await RetailerOutletTransaction.findOne({
//     billId: bill._id,
//     transactionFor: "SALES",
//     status: "Success",
//   });

//   if (existingRetailerTxn) {
//     console.log(`✅ Retailer reward already credited for bill ${finalBillNo}`);
//     return existingRetailerTxn;
//   }

//   if (!distributorTransaction) {
//     throw new Error("Distributor transaction required for retailer reward");
//   }

//   // Fetch retailer
//   const retailer = await OutletApproved.findById(bill.retailerId).lean();
//   if (!retailer?.outletUID) {
//     console.log(`Retailer UID missing for bill ${finalBillNo}`);
//     return null;
//   }

//   // Use passed distributor or fetch it
//   const dist = distributor || (await getDistributor(userId));
//   const remarkText = `Reward for Bill ${finalBillNo} for Retailer UID ${
//     retailer.outletUID
//   } and DB Code ${dist?.dbCode || "N/A"}`;

//   // Get retailer balance
//   const lastRetailerTxn = await RetailerOutletTransaction.findOne({
//     retailerId: bill.retailerId,
//   }).sort({ createdAt: -1 });

//   const retailerBalance = lastRetailerTxn
//     ? Number(lastRetailerTxn.balance)
//     : Number(retailer.currentPointBalance) || 0;

//   // Create retailer transaction with backdate fields if applicable
//   const retailerTransactionData = {
//     retailerId: bill.retailerId,
//     distributorId: userId,
//     billId: bill._id,
//     transactionId: await retailerOutletTransactionCode("RTO"),
//     distributorTransactionId: distributorTransaction._id,
//     transactionType: "credit",
//     transactionFor: "SALES",
//     point: rewardPoints,
//     balance: retailerBalance + rewardPoints,
//     status: "Success",
//     remark: remarkText,
//   };

//   // Add backdate fields if they exist on bill
//   if (bill.backdateFields) {
//     retailerTransactionData.dates = {
//       deliveryDate: bill.backdateFields.deliveryDate,
//       originalDeliveryDate: bill.backdateFields.originalDeliveryDate,
//     };
//     retailerTransactionData.enabledBackDate =
//       bill.backdateFields.enabledBackDate;
//     // Set timestamps for backdate
//     if (bill.backdateFields.deliveryDate) {
//       retailerTransactionData.createdAt = bill.backdateFields.deliveryDate;
//       retailerTransactionData.updatedAt = bill.backdateFields.deliveryDate;
//     }
//   }

//   const retailerOutletTransaction = await RetailerOutletTransaction.create(
//     retailerTransactionData,
//   );

//   // Link back to distributor transaction
//   await DistributorTransaction.updateOne(
//     { _id: distributorTransaction._id },
//     { $set: { retailerOutletTransactionId: retailerOutletTransaction._id } },
//   );

//   // Update snapshot
//   await OutletApproved.updateOne(
//     { _id: bill.retailerId },
//     { $inc: { currentPointBalance: rewardPoints } },
//   );

//   console.log(
//     `✅ Retailer reward credited for bill ${finalBillNo} → ${rewardPoints} points`,
//   );

//   return retailerOutletTransaction;
// };

// /* ==================== COMBINED REWARD ============================== */

// const createSalesRewardPoints = async (bill, userId) => {
//   const finalBillNo = bill.new_billno || bill.billNo;
//   // 🔹 Fetch distributor
//   const distributor = await getDistributor(userId);
//   if (!distributor || distributor.RBPSchemeMapped !== "yes") {
//     console.log(
//       `RBP not mapped for distributor ${userId} - skipping reward transfer`,
//     );
//     return { distributorTxn: null, retailerTxn: null, skipped: true };
//   }

//   /* ------------------ CALCULATE REWARD POINTS ------------------ */
//   let rewardPoints = 0;

//   // for (const item of getAdjustableItems(bill)) {
//   for (const item of bill.lineItems) {
//     if (isNonAdjustableItem(item)) continue;

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

//   // Step 1: Create distributor transaction (pass distributor to avoid re-fetching)
//   const distributorTxn = await createDistributorRewardTransaction(
//     bill,
//     userId,
//     rewardPoints,
//     distributor,
//   );

//   if (!distributorTxn) {
//     return { distributorTxn: null, retailerTxn: null, distributorFailed: true };
//   }

//   // Step 2: Create retailer transaction (pass distributor to avoid re-fetching)
//   const retailerTxn = await createRetailerRewardTransaction(
//     bill,
//     userId,
//     rewardPoints,
//     distributorTxn,
//     distributor,
//   );

//   return { distributorTxn, retailerTxn };
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
//   }).populate("lineItems.product lineItems.inventoryId orderId");

//   if (bills.length === 0) {
//     return res.status(404).json({
//       error: true,
//       message: "No bills found",
//     });
//   }

//   // ============ CHECK MANUAL DELIVERY PERMISSION ============
//   // Validate if manual delivery is allowed for this distributor
//   const manualDeliveryValidation = await validateManualDelivery(userId);

//   if (!manualDeliveryValidation.allowed) {
//     return res.status(403).json({
//       error: true,
//       message: manualDeliveryValidation.reason,
//       data: {
//         enableBackdateBilling:
//           manualDeliveryValidation.setting?.enableBackdateBilling || false,
//         setting: manualDeliveryValidation.setting,
//       },
//     });
//   }

//   // Log manual delivery permission status
//   console.log(
//     `Manual delivery validation for distributor ${userId}: ${manualDeliveryValidation.reason}`,
//   );

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
//         billNo: bill.billNo || "UNKNOWN",
//         error: "Missing billId or billNo - cannot process",
//       });
//       continue; // Skip this bill
//     }

//     const billId = String(bill._id);
//     const billNo = bill.billNo;

//     // Get enableBackdateBilling from the manual delivery validation setting
//     const enableBackdateBilling =
//       manualDeliveryValidation.setting?.enableBackdateBilling === true;

//     // Use order's creation date as billing date (when sale actually happened)
//     // Falls back to bill.createdAt if order not populated
//     const billingDate = bill.orderId?.createdAt || bill.createdAt;
//     const actualDeliveryDate = new Date();
//     console.log(
//       "DEBUG: actualDeliveryDate from new Date():",
//       actualDeliveryDate,
//     );
//     console.log("DEBUG: billingDate:", billingDate);
//     console.log(
//       "DEBUG: Current machine time via Date.now():",
//       new Date(Date.now()),
//     );
//     const backdateFields = calculateBackdateFields(
//       billingDate,
//       actualDeliveryDate,
//       enableBackdateBilling,
//     );

//     if (backdateFields.enabledBackDate) {
//       console.log(
//         `Backdate logic applied for manually delivered bill ${billNo}: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
//       );
//     }

//     // Store backdate fields in bill for later use in transaction creation
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
//           backdateFields: backdateFields,
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

//     let distributorRewardFailed = false;
//     let retailerRewardFailed = false;
//     // let lowBalanceWarning = null;

//     if (!productAdjustmentFailed) {
//       // All products adjusted successfully, now create ledger
//       try {
//         await createLedgerEntries(bill, userId, bill.backdateFields);
//       } catch (error) {
//         console.error(`Ledger creation failed for ${finalBillNo}:`, error);
//       }

//       // Attempt reward transfer (both distributor and retailer)
//       try {
//         const { distributorTxn, retailerTxn } = await createSalesRewardPoints(
//           bill,
//           userId,
//         );
//       } catch (error) {
//         console.error(`Reward transfer failed for ${finalBillNo}:`, error);
//         // rewardTransferFailed = true;

//         // Capture low balance warning
//         // if (error.lowBalance) {
//         //   lowBalanceWarning = {
//         //     message: "Insufficient RBP balance for reward transfer",
//         //     required: error.required,
//         //     available: error.available,
//         //   };
//         // }
//       }
//     }

//     // Check final status from database
//     const distributorRewardSuccess = await DistributorTransaction.exists({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     const retailerRewardSuccess = await RetailerOutletTransaction.exists({
//       billId: bill._id,
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
//         bill.status =
//           distributorRewardSuccess && retailerRewardSuccess
//             ? "Delivered"
//             : "Partially-Delivered";
//       } else {
//         bill.status = "Delivered";
//       }
//     } else if (failedCount > 0) {
//       // Some products failed
//       bill.status = "Partially-Delivered";
//     } else {
//       bill.status = "Pending";
//     }

//     // Set delivery date - apply backdate logic if applicable for manual delivery
//     if (bill.backdateFields) {
//       // Apply backdate fields for cross-month manual delivery
//       bill.dates.deliveryDate = bill.backdateFields.deliveryDate;
//       bill.dates.originalDeliveryDate =
//         bill.backdateFields.originalDeliveryDate;
//       bill.enabledBackDate = bill.backdateFields.enabledBackDate;
//     } else {
//       // Normal delivery - single date
//       bill.dates.deliveryDate = actualDeliveryDate;
//     }

//     await bill.save();
//     await updateSecondaryTargetAchievement(bill, userId);

//     // ============ CHECK AND UPDATE PORTAL LOCK STATUS ============
//     // After bill is delivered, check if portal should be unlocked
//     try {
//       await checkAndUpdatePortalLock(userId);
//     } catch (lockError) {
//       console.error("Error checking portal lock status:", lockError.message);
//     }
//     // ============ END PORTAL LOCK CHECK ============

//     console.log(
//       `Bill ${billNo} date updated to Delivered${bill.dates.deliveryDate}`,
//     );

//     results.push({
//       billNo: billNo,
//       status: bill.status,
//       adjusted: adjustedCount,
//       failed: failedCount,
//       distributorReward: shouldCheckReward
//         ? distributorRewardSuccess
//           ? "success"
//           : "pending"
//         : "not_required",
//       retailerReward: shouldCheckReward
//         ? retailerRewardSuccess
//           ? "success"
//           : "pending"
//         : "not_required",
//       // ...(lowBalanceWarning && { warning: lowBalanceWarning }),
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
//   }).populate("lineItems.product lineItems.inventoryId orderId");

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
//         billNo: bill.billNo || "UNKNOWN",
//         error: "Missing billId or billNo - cannot retry",
//       });
//       continue;
//     }

//     const billId = String(bill._id);
//     const billNo = bill.billNo;

//     // Fetch delivery setting for this distributor to determine enableBackdateBilling
//     // Query without isActive filter to allow backdate billing to work independently
//     const deliverySetting = await BillDeliverySetting.findOne({
//       distributorId: userId,
//     });
//     const enableBackdateBilling =
//       deliverySetting?.enableBackdateBilling === true;

//     // Use order's creation date as billing date (when sale actually happened)
//     // Falls back to bill.createdAt if order not populated
//     const billingDate = bill.orderId?.createdAt || bill.createdAt;
//     const actualDeliveryDate = new Date();
//     const backdateFields = calculateBackdateFields(
//       billingDate,
//       actualDeliveryDate,
//       enableBackdateBilling,
//     );

//     if (backdateFields.enabledBackDate) {
//       console.log(
//         `Backdate logic applied for manually retried bill ${billNo}: Real delivery=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
//       );
//     }

//     // Store backdate fields in bill for later use in transaction creation
//     bill.backdateFields = backdateFields;

//     console.log(`\n === RETRYING BILL ${finalBillNo} ===`);

//     /* ========== STEP 1: CHECK CURRENT STATE ========== */

//     const adjustableItems = getAdjustableItems(bill);
//     let adjustedCount = 0;
//     let failedCount = 0;
//     let hasFailedProducts = false;

//     // STEP 1: Retry failed product adjustments (Skip Item Removed and Stock Out)
//     for (const item of adjustableItems) {
//       const isAdjusted = await Transaction.exists({
//         billId,
//         billLineItemId: item._id,
//         transactionType: "delivery",
//         type: "Out",
//       });

//       if (isAdjusted) {
//         adjustedCount++;
//       } else {
//         failedCount++;
//       }
//     }

//     const existingDistributorTxn = await DistributorTransaction.findOne({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     const existingRetailerTxn = await RetailerOutletTransaction.findOne({
//       billId: bill._id,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     const distributor = await Distributor.findById(userId);
//     const shouldCheckReward =
//       bill.totalBasePoints > 0 && distributor?.RBPSchemeMapped === "yes";

//     console.log(`Current State:`);
//     console.log(`Products: ${adjustedCount}/${adjustableItems.length}`);
//     console.log(`Distributor Reward: ${existingDistributorTxn ? "✅" : "❌"}`);
//     console.log(`Retailer Reward: ${existingRetailerTxn ? "✅" : "❌"}`);
//     console.log(`Should Check Reward: ${shouldCheckReward}`);

//     /* ========== STEP 2: RETRY FAILED PRODUCTS ========== */

//     if (failedCount > 0) {
//       console.log(`\n Retrying ${failedCount} failed products...`);

//       for (const item of bill.lineItems) {
//         if (isNonAdjustableItem(item)) {
//           console.log(
//             `Skipping non-adjustable item: ${item.product} (${item.itemBillType})`,
//           );
//           continue;
//         }

//         // Check if already successfully adjusted using Transaction table
//         const alreadyAdjusted = await Transaction.exists({
//           billId: billId,
//           billLineItemId: item._id,
//           transactionType: "delivery",
//           type: "Out",
//         });

//         if (alreadyAdjusted) {
//           item.adjustmentStatus = "success";
//           adjustedCount++;
//           continue;
//         }

//         // This item needs adjustment
//         try {
//           if (!item.product || !item.inventoryId) {
//             throw new AdjustmentError(
//               "Missing product or inventory data",
//               true,
//             );
//           }

//           await adjustSingleLineItem(item, billId, billNo, userId, {
//             forceRetry: true,
//             deliveryDate: backdateFields.deliveryDate,
//             backdateFields: backdateFields,
//           });
//           console.log(`Product adjusted`);
//           item.adjustmentStatus = "success";
//           // hasFailedProducts = false; // This product succeeded on retry
//         } catch (error) {
//           console.log(`Product failed: ${error.message}`);
//           item.adjustmentStatus = "failed";
//           item.adjustmentError = error.message;
//           item.adjustmentAttempts = (item.adjustmentAttempts || 0) + 1;
//           item.lastAdjustmentAttempt = new Date();
//           item.adjustmentNonRetriable = error.nonRetriable || false;
//         }
//       }
//     } else {
//       console.log(`\n All products already adjusted`);
//     }

//     /* ========== STEP 3: RECOUNT AFTER PRODUCT RETRY ========== */
//     adjustedCount = 0;
//     failedCount = 0;
//     let allProductsAdjusted = true;

//     for (const item of adjustableItems) {
//       const isAdjusted = await Transaction.exists({
//         billId: billId,
//         billLineItemId: item._id,
//         transactionType: "delivery",
//         type: "Out",
//       });
//       if (isAdjusted) {
//         adjustedCount++;
//       } else {
//         failedCount++;
//         allProductsAdjusted = false;
//       }
//     }

//     console.log(
//       `\n After Product Retry: ${adjustedCount}/${adjustableItems.length}`,
//     );

//     /* ========== STEP 4: LEDGER & REWARD RETRY ========== */
//     if (allProductsAdjusted && failedCount === 0) {
//       console.log(`\n Creating ledger entries...`);
//       try {
//         await createLedgerEntries(bill, userId, bill.backdateFields);
//         console.log(` Ledger created`);
//       } catch (error) {
//         console.log(` Ledger failed: ${error.message}`);
//       }
//     } else {
//       console.log(`\n Skipping ledger - products not all adjusted`);
//     }

//     /* ========== STEP 5: REWARD RETRY LOGIC ========== */
//     // let lowBalanceWarning = null;

//     if (shouldCheckReward) {
//       console.log(`\n Attempting reward transfer...`);

//       // Calculate reward points once
//       let rewardPoints = 0;
//       for (const item of bill.lineItems) {
//         if (isNonAdjustableItem(item)) continue;

//         const delivered = await Transaction.exists({
//           billId: bill._id,
//           billLineItemId: item._id,
//           transactionType: "delivery",
//           type: "Out",
//         });

//         if (!delivered) continue;

//         const basePoint = Number(
//           item.usedBasePoint ?? item.product?.base_point ?? 0,
//         );
//         rewardPoints += basePoint * Number(item.billQty || 0);
//       }

//       if (rewardPoints !== bill.totalBasePoints) {
//         rewardPoints = bill.totalBasePoints;
//       }

//       console.log(`Required Points: ${rewardPoints}`);

//       // Re-check reward status
//       const distTxnAfterRetry = await DistributorTransaction.findOne({
//         billId: bill._id,
//         distributorId: userId,
//         transactionFor: "SALES",
//         status: "Success",
//       });

//       const retailTxnAfterRetry = await RetailerOutletTransaction.findOne({
//         billId: bill._id,
//         transactionFor: "SALES",
//         status: "Success",
//       });

//       const retailer = await OutletApproved.findById(bill.retailerId).lean();

//       try {
//         /* --- CASE 1: Both rewards already successful --- */
//         if (distTxnAfterRetry && retailTxnAfterRetry) {
//           console.log(`Both rewards already completed`);
//         } else if (distTxnAfterRetry && !retailTxnAfterRetry) {
//           /* --- CASE 2: Distributor success, retailer missing --- */
//           console.log(`Retrying retailer reward...`);

//           if (!retailer?.outletUID) {
//             throw new Error("Retailer UID missing");
//           }

//           await createRetailerRewardTransaction(
//             bill,
//             userId,
//             rewardPoints,
//             distTxnAfterRetry,
//             distributor,
//           );

//           console.log(`Retailer reward created`);
//         } else if (!distTxnAfterRetry && retailTxnAfterRetry) {
//           /* --- CASE 3: Distributor missing, retailer exists (edge case) --- */
//           console.log(` Inconsistent: Retailer exists, distributor missing`);
//           console.log(`Creating distributor reward...`);

//           if (!retailer?.outletUID) {
//             throw new Error("Retailer UID missing");
//           }

//           const newDistTxn = await createDistributorRewardTransaction(
//             bill,
//             userId,
//             rewardPoints,
//             distributor,
//           );

//           if (newDistTxn) {
//             console.log(`Distributor reward created`);
//           }
//         } else {
//           /* --- CASE 4: Both missing --- */
//           console.log(`Creating both rewards...`);

//           const { distributorTxn, retailerTxn } = await createSalesRewardPoints(
//             bill,
//             userId,
//           );

//           if (distributorTxn && retailerTxn) {
//             console.log(`Both rewards created`);
//           } else if (distributorTxn && !retailerTxn) {
//             console.log(`Distributor created, retailer failed`);
//           } else {
//             console.log(`Both rewards failed`);
//           }
//         }
//       } catch (error) {
//         console.log(` Reward failed: ${error.message}`);

//         // if (error.lowBalance) {
//         //   lowBalanceWarning = {
//         //     message: `Insufficient RBP balance`,
//         //     required: error.required,
//         //     available: error.available,
//         //   };
//         // }
//       }
//     } else {
//       console.log(`\n Skipping rewards - RBP not mapped or no points`);
//     }

//     /* ========== STEP 6: FINAL STATUS UPDATE ========== */
//     const finalDistributorReward = await DistributorTransaction.exists({
//       billId: bill._id,
//       distributorId: userId,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     const finalRetailerReward = await RetailerOutletTransaction.exists({
//       billId: bill._id,
//       transactionFor: "SALES",
//       status: "Success",
//     });

//     // Recount final product status
//     adjustedCount = 0;
//     failedCount = 0;
//     for (const item of adjustableItems) {
//       const isAdjusted = await Transaction.exists({
//         billId,
//         billLineItemId: item._id,
//         transactionType: "delivery",
//         type: "Out",
//       });
//       if (isAdjusted) {
//         adjustedCount++;
//       } else {
//         failedCount++;
//       }
//     }

//     /* ========== STEP 7: DETERMINE FINAL BILL STATUS ========== */

//     if (failedCount === 0 && adjustedCount > 0) {
//       // All products adjusted
//       if (shouldCheckReward) {
//         bill.status =
//           finalDistributorReward && finalRetailerReward
//             ? "Delivered"
//             : "Partially-Delivered";
//       } else {
//         bill.status = "Delivered";
//       }
//     } else {
//       // Some products still failing
//       bill.status = "Partially-Delivered";
//     }

//     /* ========== STEP 8: UPDATE BILL ========== */

//     bill.adjustmentSummary = {
//       totalProducts: adjustableItems.length,
//       successfulAdjustments: adjustedCount,
//       failedAdjustments: failedCount,
//       lastRetryAttempt: new Date(),
//     };

//     // Set delivery date - apply backdate logic if applicable for manual retry
//     if (bill.backdateFields) {
//       // Apply backdate fields for cross-month manual retry
//       bill.dates.deliveryDate = bill.backdateFields.deliveryDate;
//       bill.dates.originalDeliveryDate =
//         bill.backdateFields.originalDeliveryDate;
//       bill.enabledBackDate = bill.backdateFields.enabledBackDate;
//     } else {
//       // Normal retry - single date
//       bill.dates.deliveryDate = actualDeliveryDate;
//     }

//     await bill.save();
//     await updateSecondaryTargetAchievement(bill, userId);

//     // ============ CHECK AND UPDATE PORTAL LOCK STATUS (RETRY) ============
//     try {
//       await checkAndUpdatePortalLock(userId);
//     } catch (lockError) {
//       console.error("Error checking portal lock status:", lockError.message);
//     }
//     // ============ END PORTAL LOCK CHECK (RETRY) ============

//     console.log(
//       `Bill ${finalBillNo || billNo} date updated to Delivered${
//         bill.dates.deliveryDate
//       }`,
//     );

//     /* ========== STEP 9: BUILD RESPONSE ========== */
//     results.push({
//       billNo: billNo,
//       status: bill.status,
//       adjusted: adjustedCount,
//       failed: failedCount,
//       rewardStatus: shouldCheckReward
//         ? finalDistributorReward
//           ? "success"
//           : "pending"
//         : "not_required",
//       retailerReward: shouldCheckReward
//         ? finalRetailerReward
//           ? "success"
//           : "pending"
//         : "not_required",
//       // ...(lowBalanceWarning && { warning: lowBalanceWarning }),
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
//   createDistributorRewardTransaction,
//   createRetailerRewardTransaction,
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
