const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");

const Bill = require("../../../models/bill.model");
const Transaction = require("../../../models/transaction.model");
const Ledger = require("../../../models/ledger.model");
const Inventory = require("../../../models/inventory.model");
const {
  transactionCode,
  ledgerTransactionCode,
} = require("../../../utils/codeGenerator");

let Distributor;
try {
  Distributor = require("../../../models/distributor.model");
} catch {
  Distributor = null;
}

/* ===================== HELPER FUNCTIONS ============================ */

const isValidLineItem = (item) => {
  // Check if item has valid billQty and is not marked as removed or out of stock
  const billQty = Number(item.billQty || 0);
  const isRemoved =
    item.itemBillType === "Item Removed" || item.itemBillType === "Stock out";
  return billQty > 0 && !isRemoved;
};

const getValidLineItems = (bill) => {
  return (bill.lineItems || []).filter(isValidLineItem);
};

const doesTransactionExist = async (billId, billLineItemId) => {
  const exists = await Transaction.findOne({
    billId,
    billLineItemId,
    transactionType: "delivery",
    type: "Out",
  });
  return !!exists;
};

const doesLedgerExist = async (billId, dbId, retailerId) => {
  const exists = await Ledger.findOne({
    billId,
    dbId,
    retailerId,
    transactionFor: "Sales",
  });
  return !!exists;
};

/* ===================== CREATE TRANSACTION ============================ */

const createTransactionForLineItem = async (
  bill,
  lineItem,
  distributorId,
  transactionDate,
) => {
  const billId = bill._id;
  const billNo = bill.billNo;
  const lineItemId = lineItem._id;
  const productId = lineItem.product?._id || lineItem.product;
  const invId = lineItem.inventoryId?._id || lineItem.inventoryId;
  const billQty = Number(lineItem.billQty || 0);

  // Validate required fields
  if (!billId || !billNo || !lineItemId || !productId || !invId) {
    throw new Error(
      "Missing required fields: billId, billNo, lineItemId, productId, or invId",
    );
  }

  if (billQty <= 0) {
    throw new Error(`Invalid billQty: ${billQty}`);
  }

  // Check if transaction already exists (duplicate prevention)
  const alreadyExists = await doesTransactionExist(billId, lineItemId);
  if (alreadyExists) {
    return {
      success: true,
      action: "skipped",
      reason: "Transaction already exists",
      billNo,
    };
  }

  // Generate transaction ID
  const txnId = await transactionCode("LXSTA");

  // Create transaction
  const transactionData = {
    distributorId,
    productId,
    invItemId: invId,
    billId,
    billLineItemId: lineItemId,
    qty: billQty,
    date: transactionDate,
    transactionId: txnId,
    type: "Out",
    transactionType: "delivery",
    stockType: "salable",
    description: `Delivered against Bill ${billNo}`,
  };

  const createdTransaction = await Transaction.create(transactionData);

  return {
    success: true,
    action: "created",
    transactionId: txnId,
    billNo,
  };
};

/* ===================== CREATE LEDGER ============================ */

const createLedgerForBill = async (bill, distributorId, ledgerDate) => {
  const billId = bill._id;
  const retailerId = bill.retailerId;

  // Check if ledger already exists
  const alreadyExists = await doesLedgerExist(
    billId,
    distributorId,
    retailerId,
  );
  if (alreadyExists) {
    return {
      success: true,
      action: "skipped",
      reason: "Ledger already exists",
      billNo: bill.billNo,
    };
  }

  // Get last ledger balance for this distributor-retailer pair
  const lastLedger = await Ledger.findOne({
    dbId: distributorId,
    retailerId: retailerId,
  })
    .sort({ createdAt: -1 })
    .select("balance")
    .lean();

  const currentBalance = lastLedger ? Number(lastLedger.balance) : 0;
  const transactionAmount = Number(bill.netAmount) || 0;
  const newBalance = currentBalance - transactionAmount;

  // Generate ledger transaction ID
  const ledgerTxnId = await ledgerTransactionCode("LEDG", distributorId);

  // Create ledger entry
  const ledgerData = {
    dbId: distributorId,
    retailerId: retailerId,
    billId: billId,
    transactionId: ledgerTxnId,
    date: ledgerDate,
    transactionType: "debit",
    transactionFor: "Sales",
    transactionAmount: transactionAmount,
    balance: newBalance,
    createdAt: ledgerDate,
    updatedAt: ledgerDate,
  };

  await Ledger.create(ledgerData);

  return {
    success: true,
    action: "created",
    transactionId: ledgerTxnId,
    amount: transactionAmount,
    billNo: bill.billNo,
  };
};

/* ===================== PROCESS BILL ============================ */

const processBill = async (bill, distributorId, summary) => {
  const billId = String(bill._id);
  const billNo = bill.billNo;

  console.log(`  📋 Bill: ${billNo}`);

  // Get valid line items
  const validItems = getValidLineItems(bill);

  if (validItems.length === 0) {
    console.log(`    ⏭️ No valid line items found`);
    summary.billsSkipped++;
    return;
  }

  // Get transaction date from bill.dates.deliveryDate
  const transactionDate =
    bill.dates?.deliveryDate || bill.createdAt || new Date();

  let transactionsCreated = 0;
  let transactionsSkipped = 0;
  let transactionErrors = 0;

  // Create transactions for each valid line item
  for (const lineItem of validItems) {
    try {
      const result = await createTransactionForLineItem(
        bill,
        lineItem,
        distributorId,
        transactionDate,
      );

      if (result.action === "created") {
        transactionsCreated++;
        console.log(`      ✅ Transaction created: ${result.transactionId}`);
      } else if (result.action === "skipped") {
        transactionsSkipped++;
        console.log(`      ⏭️ Transaction skipped (already exists)`);
      }
    } catch (error) {
      transactionErrors++;
      console.log(`      ❌ Transaction failed: ${error.message}`);
      summary.errors.push({
        type: "transaction_creation",
        bill: billNo,
        error: error.message,
      });
    }
  }

  // Create ledger entry if transactions were created or attempted
  if (transactionsCreated > 0 || transactionsSkipped > 0) {
    try {
      const ledgerResult = await createLedgerForBill(
        bill,
        distributorId,
        transactionDate,
      );

      if (ledgerResult.action === "created") {
        console.log(`      📒 Ledger created: ${ledgerResult.transactionId}`);
        summary.ledgersCreated++;
      } else if (ledgerResult.action === "skipped") {
        console.log(`      📒 Ledger skipped (already exists)`);
      }
    } catch (error) {
      console.log(`      ❌ Ledger creation failed: ${error.message}`);
      summary.errors.push({
        type: "ledger_creation",
        bill: billNo,
        error: error.message,
      });
    }
  }

  // Update summary
  summary.billsProcessed++;
  summary.transactionsCreated += transactionsCreated;
  summary.transactionsSkipped += transactionsSkipped;
  summary.transactionErrors += transactionErrors;
};

/* ===================== PROCESS DISTRIBUTOR ============================ */

const processDistributor = async (distributorId, filters, summary) => {
  console.log(`\n👤 Distributor: ${distributorId}`);

  // Build bill query
  const billQuery = {
    distributorId: distributorId,
    status: "Delivered", // Only process delivered bills
  };

  // Apply optional filters
  if (filters.billNumbers && filters.billNumbers.length > 0) {
    billQuery.billNo = { $in: filters.billNumbers };
  }

  if (filters.billIds && filters.billIds.length > 0) {
    billQuery._id = { $in: filters.billIds };
  }

  if (filters.dateRange?.from || filters.dateRange?.to) {
    billQuery["dates.deliveryDate"] = {};
    if (filters.dateRange.from) {
      billQuery["dates.deliveryDate"].$gte = new Date(filters.dateRange.from);
    }
    if (filters.dateRange.to) {
      billQuery["dates.deliveryDate"].$lte = new Date(filters.dateRange.to);
    }
  }

  // Fetch bills (no limit - process all matching bills)
  const bills = await Bill.find(billQuery)
    .populate("lineItems.product lineItems.inventoryId")
    .sort({ "dates.deliveryDate": 1 });

  if (bills.length === 0) {
    console.log(`  ⏭️ No bills found for this distributor`);
    summary.distributorsProcessed++;
    return;
  }

  console.log(`  📊 Found ${bills.length} bills`);

  // Process each bill
  for (const bill of bills) {
    await processBill(bill, distributorId, summary);
  }

  summary.distributorsProcessed++;
};

/* ===================== MAIN CONTROLLER ============================ */

/**
 * Recreate transactions for bills
 *
 * Request Body:
 * {
 *   "distributorIds": ["123", "456"], // Optional: specific distributor IDs
 *   "billNumbers": ["BILL001", "BILL002"], // Optional: specific bill numbers
 *   "billIds": ["123", "456"], // Optional: specific bill IDs
 *   "dateRange": { // Optional: filter by delivery date
 *     "from": "2025-01-01",
 *     "to": "2025-12-31"
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Transaction recreation completed",
 *   "summary": {
 *     "distributorsProcessed": 1,
 *     "billsProcessed": 5,
 *     "billsSkipped": 0,
 *     "transactionsCreated": 8,
 *     "transactionsSkipped": 2,
 *     "transactionErrors": 0,
 *     "ledgersCreated": 5,
 *     "errors": []
 *   }
 * }
 */
const recreateBillTransactions = asyncHandler(async (req, res) => {
  console.log("\n========== RECREATE BILL TRANSACTIONS STARTED ==========");

  const {
    distributorIds = [],
    billNumbers = [],
    billIds = [],
    dateRange = null,
  } = req.body || {};

  // Validate inputs
  if (
    distributorIds.length === 0 &&
    billNumbers.length === 0 &&
    billIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message:
        "At least one filter is required: distributorIds, billNumbers, or billIds",
    });
  }

  const summary = {
    distributorsProcessed: 0,
    billsProcessed: 0,
    billsSkipped: 0,
    transactionsCreated: 0,
    transactionsSkipped: 0,
    transactionErrors: 0,
    ledgersCreated: 0,
    errors: [],
  };

  const filters = {
    billNumbers,
    billIds,
    dateRange,
  };

  try {
    // If specific distributors provided, process them
    if (distributorIds.length > 0) {
      console.log(`\n📋 Processing ${distributorIds.length} distributors...`);

      for (const distributorId of distributorIds) {
        await processDistributor(distributorId, filters, summary);
      }
    }
    // If bill numbers or IDs provided without distributors, get distributors from bills
    else if (billNumbers.length > 0 || billIds.length > 0) {
      console.log(`\n📋 Processing bills by number/ID...`);

      const billQuery = {};
      if (billNumbers.length > 0) {
        billQuery.billNo = { $in: billNumbers };
      }
      if (billIds.length > 0) {
        billQuery._id = { $in: billIds };
      }

      const bills = await Bill.find(billQuery)
        .select("distributorId")
        .distinct("distributorId");

      for (const distributorId of bills) {
        await processDistributor(String(distributorId), filters, summary);
      }
    }

    console.log("\n========== RECREATE BILL TRANSACTIONS COMPLETED ==========");
    console.log(`✅ Distributors Processed: ${summary.distributorsProcessed}`);
    console.log(`✅ Bills Processed: ${summary.billsProcessed}`);
    console.log(`⏭️ Bills Skipped: ${summary.billsSkipped}`);
    console.log(`✅ Transactions Created: ${summary.transactionsCreated}`);
    console.log(`⏭️ Transactions Skipped: ${summary.transactionsSkipped}`);
    console.log(`❌ Transaction Errors: ${summary.transactionErrors}`);
    console.log(`✅ Ledgers Created: ${summary.ledgersCreated}`);
    if (summary.errors.length > 0) {
      console.log(`⚠️ Total Errors: ${summary.errors.length}`);
    }

    res.status(200).json({
      success: true,
      message: "Transaction recreation completed",
      summary,
    });
  } catch (error) {
    console.error("\n❌ Error during recreate bill transactions:", error);

    summary.errors.push({
      type: "fatal_error",
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: "Error during transaction recreation",
      error: error.message,
      summary,
    });
  }
});

module.exports = {
  recreateBillTransactions,
  // Export helper functions for testing/reuse if needed
  processDistributor,
  processBill,
  createTransactionForLineItem,
  createLedgerForBill,
};
