// const mongoose = require("mongoose");
// const Transaction = require("../../models/transaction.model");
// const StockLedger = require("../../models/stockLedger.model");
// const Product = require("../../models/product.model");

// async function createStockLedgerEntry(transactionId) {
//   try {
//     // 1. Fetch the transaction
//     console.log("i was called for")
//     const transaction = await Transaction.findById(transactionId).lean();

//     if (!transaction) {
//       throw new Error(`Transaction not found: ${transactionId}`);
//     }

//     const { distributorId, productId, type, qty, date } = transaction;

//     // 2. Check if ledger entry already exists for this transaction
//     const existingLedger = await StockLedger.findOne({
//       transactionId: new mongoose.Types.ObjectId(transactionId)
//     }).lean();

//     if (existingLedger) {
//       console.log(`Stock ledger entry already exists for transaction: ${transactionId}`);
//       return existingLedger; // Return existing entry instead of throwing error
//     }

//     // 3. Get product details for base_points
//     const product = await Product.findById(productId).lean();

//     if (!product) {
//       throw new Error(`Product not found: ${productId}`);
//     }

//     const basePoints = product.base_point || 0;

//     // 4. Find the most recent ledger entry for this distributor-product combination
//     const previousLedger = await StockLedger.findOne({
//       distributorId: new mongoose.Types.ObjectId(distributorId),
//       productId: new mongoose.Types.ObjectId(productId),
//       date: { $lt: new Date(date) } // Only entries BEFORE this transaction
//     })
//       .sort({ date: -1, _id: -1 }) // Most recent first
//       .lean();

//     // 5. Calculate opening balance (from previous ledger's closing, or 0 if first entry)
//     const openingStock = previousLedger ? previousLedger.closingStock : 0;
//     const openingPoints = previousLedger ? previousLedger.closingPoints : 0;

//     // 6. Calculate quantity and points change
//     const qtyChange = type === "In" ? qty : -qty;
//     const pointChange = type === "In" ? (qty * basePoints) : -(qty * basePoints);

//     // 7. Calculate closing balance
//     const closingStock = openingStock + qtyChange;
//     const closingPoints = openingPoints + pointChange;

//     // 8. Create the stock ledger entry
//     const ledgerEntry = await StockLedger.create({
//       distributorId: new mongoose.Types.ObjectId(distributorId),
//       productId: new mongoose.Types.ObjectId(productId),
//       transactionId: new mongoose.Types.ObjectId(transactionId),
//       date: new Date(date),
//       openingStock,
//       openingPoints,
//       transactionType: transaction.transactionType,
//       qtyChange,
//       pointChange,
//       closingStock,
//       closingPoints
//     });

//     console.log(` Stock ledger entry created for transaction: ${transactionId} | Stock: ${openingStock} → ${closingStock} | Points: ${openingPoints} → ${closingPoints}`);

//     return ledgerEntry;

//   } catch (error) {
//     console.error(`Error creating stock ledger entry for transaction ${transactionId}:`, error.message);
//     throw error; // Re-throw so caller can handle
//   }
// }

// async function createBulkStockLedgerEntries(transactions) {
//   try {
//     if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
//       console.log('No transactions provided for bulk stock ledger creation');
//       return [];
//     }

//     console.log(`Creating stock ledger entries for ${transactions.length} transactions`);

//     const ledgerEntries = [];

//     for (const transaction of transactions) {
//       const { distributorId, productId, type, qty, date, _id } = transaction;

//       // Check if ledger entry already exists
//       const existingLedger = await StockLedger.findOne({
//         transactionId: new mongoose.Types.ObjectId(_id)
//       }).lean();

//       if (existingLedger) {
//         console.log(`Stock ledger entry already exists for transaction: ${_id}`);
//         continue;
//       }

//       // Get product details for base_points
//       const product = await Product.findById(productId).lean();
//       if (!product) {
//         console.error(`Product not found for transaction ${_id}: ${productId}`);
//         continue;
//       }

//       const basePoints = product.base_point || 0;

//       // Find previous ledger entry
//       const previousLedger = await StockLedger.findOne({
//         distributorId: new mongoose.Types.ObjectId(distributorId),
//         productId: new mongoose.Types.ObjectId(productId),
//         date: { $lt: new Date(date) }
//       })
//         .sort({ date: -1, _id: -1 })
//         .lean();

//       const openingStock = previousLedger ? previousLedger.closingStock : 0;
//       const openingPoints = previousLedger ? previousLedger.closingPoints : 0;

//       const qtyChange = type === "In" ? qty : -qty;
//       const pointChange = type === "In" ? (qty * basePoints) : -(qty * basePoints);

//       const closingStock = openingStock + qtyChange;
//       const closingPoints = openingPoints + pointChange;

//       ledgerEntries.push({
//         distributorId: new mongoose.Types.ObjectId(distributorId),
//         productId: new mongoose.Types.ObjectId(productId),
//         transactionId: new mongoose.Types.ObjectId(_id),
//         date: new Date(date),
//         openingStock,
//         openingPoints,
//         transactionType: transaction.transactionType,
//         qtyChange,
//         pointChange,
//         closingStock,
//         closingPoints
//       });
//     }

//     if (ledgerEntries.length > 0) {
//       await StockLedger.insertMany(ledgerEntries);
//       console.log(`✅ Created ${ledgerEntries.length} stock ledger entries in bulk`);
//     }

//     return ledgerEntries;

//   } catch (error) {
//     console.error('Error creating bulk stock ledger entries:', error.message);
//     throw error;
//   }
// }

// module.exports = { createStockLedgerEntry, createBulkStockLedgerEntries };

const mongoose = require("mongoose");
const Transaction = require("../../models/transaction.model");
const StockLedger = require("../../models/stockLedger.model");
const Product = require("../../models/product.model");

async function createStockLedgerEntry(transactionId) {
  try {
    // 1. Fetch the transaction
    console.log("i was called for");
    const transaction = await Transaction.findById(transactionId).lean();

    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const { distributorId, productId, type, qty, date } = transaction;

    // 2. Check if ledger entry already exists for this transaction
    const existingLedger = await StockLedger.findOne({
      transactionId: new mongoose.Types.ObjectId(transactionId),
    }).lean();

    if (existingLedger) {
      console.log(
        `Stock ledger entry already exists for transaction: ${transactionId}`,
      );
      return existingLedger; // Return existing entry instead of throwing error
    }

    // 3. Get product details for base_points
    const product = await Product.findById(productId).lean();

    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    const basePoints = product.base_point || 0;

    // 4. Find the most recent ledger entry for this distributor-product combination
    const previousLedger = await StockLedger.findOne({
      distributorId: new mongoose.Types.ObjectId(distributorId),
      productId: new mongoose.Types.ObjectId(productId),
      date: { $lt: new Date(date) }, // Only entries BEFORE this transaction
    })
      .sort({ date: -1, _id: -1 }) // Most recent first
      .lean();

    // 5. Calculate opening balance (from previous ledger's closing, or 0 if first entry)
    const openingStock = previousLedger ? previousLedger.closingStock : 0;
    const openingPoints = previousLedger ? previousLedger.closingPoints : 0;

    console.log("📋 PREVIOUS LEDGER FOUND");
    if (previousLedger) {
      console.log("  Previous Ledger ID:", previousLedger._id);
      console.log("  Previous Date:", previousLedger.date);
      console.log("  Previous Closing Stock:", previousLedger.closingStock);
      console.log("  Previous Closing Points:", previousLedger.closingPoints);
    } else {
      console.log("  No previous ledger - this is the first entry");
    }
    console.log("  Opening Stock (for new entry):", openingStock);
    console.log("  Opening Points (for new entry):", openingPoints);

    // 6. Calculate quantity and points change
    const qtyChange = type === "In" ? qty : -qty;
    const pointChange = type === "In" ? qty * basePoints : -(qty * basePoints);

    // 7. Calculate closing balance
    const closingStock = openingStock + qtyChange;
    const closingPoints = openingPoints + pointChange;

    console.log("🧮 CALCULATION DETAILS - THIS IS THE CRITICAL PART!");
    console.log("  Transaction Type:", transaction.transactionType);
    console.log("  Type (In/Out):", type);
    console.log("  Quantity from transaction:", qty);
    console.log("  Base Points:", basePoints);
    console.log("───────────────────────────────────────────────────────────");
    console.log("  Opening Stock:", openingStock);
    console.log(
      "  Qty Change:",
      qtyChange,
      `(${type === "In" ? "+" : "-"}${qty})`,
    );
    console.log("  CALCULATION: closingStock = openingStock + qtyChange");
    console.log(
      "  CALCULATION:",
      closingStock,
      "=",
      openingStock,
      "+",
      qtyChange,
    );
    console.log("  Closing Stock (RESULT):", closingStock);
    console.log("───────────────────────────────────────────────────────────");
    console.log("  Opening Points:", openingPoints);
    console.log("  Point Change:", pointChange);
    console.log("  Closing Points:", closingPoints);
    console.log("───────────────────────────────────────────────────────────");

    // VALIDATION CHECK
    const expectedClosing = openingStock + qtyChange;
    if (closingStock !== expectedClosing) {
      console.error("❌❌❌ CRITICAL ERROR DETECTED! ❌❌❌");
      console.error("  Closing stock calculation is WRONG!");
      console.error("  Expected:", expectedClosing);
      console.error("  Actual:", closingStock);
      console.error("  This is the BUG!");
    } else {
      console.log("✅ Calculation verified correct");
    }
    console.log("───────────────────────────────────────────────────────────");

    // 8. Create the stock ledger entry
    const ledgerEntry = await StockLedger.create({
      distributorId: new mongoose.Types.ObjectId(distributorId),
      productId: new mongoose.Types.ObjectId(productId),
      transactionId: new mongoose.Types.ObjectId(transactionId),
      date: new Date(date),
      openingStock,
      openingPoints,
      transactionType: transaction.transactionType,
      qtyChange,
      pointChange,
      closingStock,
      closingPoints,
    });

    console.log("✅ LEDGER ENTRY CREATED IN DATABASE");
    console.log("  Ledger Entry ID:", ledgerEntry._id);
    console.log("  Distributor ID:", ledgerEntry.distributorId);
    console.log("  Product ID:", ledgerEntry.productId);
    console.log("  Date:", ledgerEntry.date);
    console.log("  Opening Stock:", ledgerEntry.openingStock);
    console.log("  Qty Change:", ledgerEntry.qtyChange);
    console.log("  Closing Stock:", ledgerEntry.closingStock);
    console.log("  Opening Points:", ledgerEntry.openingPoints);
    console.log("  Point Change:", ledgerEntry.pointChange);
    console.log("  Closing Points:", ledgerEntry.closingPoints);
    console.log(
      "╔═══════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║ CREATE STOCK LEDGER ENTRY - SUCCESS                       ║",
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════╝",
    );

    console.log(
      ` Stock ledger entry created for transaction: ${transactionId} | Stock: ${openingStock} → ${closingStock} | Points: ${openingPoints} → ${closingPoints}`,
    );

    return ledgerEntry;
  } catch (error) {
    console.error(
      `Error creating stock ledger entry for transaction ${transactionId}:`,
      error.message,
    );
    throw error; // Re-throw so caller can handle
  }
}

async function createBulkStockLedgerEntries(transactions) {
  try {
    if (
      !transactions ||
      !Array.isArray(transactions) ||
      transactions.length === 0
    ) {
      console.log("No transactions provided for bulk stock ledger creation");
      return [];
    }

    console.log(
      `Creating stock ledger entries for ${transactions.length} transactions`,
    );

    const ledgerEntries = [];

    for (const transaction of transactions) {
      const { distributorId, productId, type, qty, date, _id } = transaction;

      // Check if ledger entry already exists
      const existingLedger = await StockLedger.findOne({
        transactionId: new mongoose.Types.ObjectId(_id),
      }).lean();

      if (existingLedger) {
        console.log(
          `Stock ledger entry already exists for transaction: ${_id}`,
        );
        continue;
      }

      // Get product details for base_points
      const product = await Product.findById(productId).lean();
      if (!product) {
        console.error(`Product not found for transaction ${_id}: ${productId}`);
        continue;
      }

      const basePoints = product.base_point || 0;

      // Find previous ledger entry
      const previousLedger = await StockLedger.findOne({
        distributorId: new mongoose.Types.ObjectId(distributorId),
        productId: new mongoose.Types.ObjectId(productId),
        date: { $lt: new Date(date) },
      })
        .sort({ date: -1, _id: -1 })
        .lean();

      const openingStock = previousLedger ? previousLedger.closingStock : 0;
      const openingPoints = previousLedger ? previousLedger.closingPoints : 0;

      const qtyChange = type === "In" ? qty : -qty;
      const pointChange =
        type === "In" ? qty * basePoints : -(qty * basePoints);

      const closingStock = openingStock + qtyChange;
      const closingPoints = openingPoints + pointChange;

      ledgerEntries.push({
        distributorId: new mongoose.Types.ObjectId(distributorId),
        productId: new mongoose.Types.ObjectId(productId),
        transactionId: new mongoose.Types.ObjectId(_id),
        date: new Date(date),
        openingStock,
        openingPoints,
        transactionType: transaction.transactionType,
        qtyChange,
        pointChange,
        closingStock,
        closingPoints,
      });
    }

    if (ledgerEntries.length > 0) {
      await StockLedger.insertMany(ledgerEntries);
      console.log(
        `✅ Created ${ledgerEntries.length} stock ledger entries in bulk`,
      );
    }

    return ledgerEntries;
  } catch (error) {
    console.error("Error creating bulk stock ledger entries:", error.message);
    throw error;
  }
}

/**
 * Recalculate stock ledger entries after transaction deletion
 * This function handles the cascading recalculation when transactions are deleted
 *
 * @param {Array} deletedTransactions - Array of deleted transaction objects
 * @returns {Object} Summary of recalculation results
 */
async function recalculateStockLedgerAfterDeletion(deletedTransactions) {
  try {
    if (!deletedTransactions || deletedTransactions.length === 0) {
      console.log("No transactions to process for ledger recalculation");
      return { success: true, recalculated: 0, deleted: 0 };
    }

    console.log(
      `Starting stock ledger recalculation for ${deletedTransactions.length} deleted transactions`,
    );

    // Group deleted transactions by distributorId + productId
    const affectedCombinations = new Map();

    for (const transaction of deletedTransactions) {
      const key = `${transaction.distributorId}_${transaction.productId}`;

      if (!affectedCombinations.has(key)) {
        affectedCombinations.set(key, {
          distributorId: transaction.distributorId,
          productId: transaction.productId,
          earliestDate: transaction.date,
          deletedTransactionIds: [transaction._id],
        });
      } else {
        const existing = affectedCombinations.get(key);
        existing.deletedTransactionIds.push(transaction._id);
        // Track the earliest deletion date for this combination
        if (new Date(transaction.date) < new Date(existing.earliestDate)) {
          existing.earliestDate = transaction.date;
        }
      }
    }

    let totalDeleted = 0;
    let totalRecalculated = 0;

    // Process each affected distributor-product combination
    for (const [key, data] of affectedCombinations) {
      const { distributorId, productId, earliestDate, deletedTransactionIds } =
        data;

      console.log(
        `Processing ${key}: ${deletedTransactionIds.length} deleted transactions, earliest date: ${earliestDate}`,
      );

      // Step 1: Delete ledger entries for the deleted transactions
      const deleteResult = await StockLedger.deleteMany({
        transactionId: {
          $in: deletedTransactionIds.map(
            (id) => new mongoose.Types.ObjectId(id),
          ),
        },
      });

      totalDeleted += deleteResult.deletedCount;
      console.log(
        `  Deleted ${deleteResult.deletedCount} ledger entries for deleted transactions`,
      );

      // Step 2: Find all remaining ledger entries from the earliest deletion date onwards
      const affectedLedgers = await StockLedger.find({
        distributorId: new mongoose.Types.ObjectId(distributorId),
        productId: new mongoose.Types.ObjectId(productId),
        date: { $gte: new Date(earliestDate) },
      })
        .sort({ date: 1, _id: 1 })
        .lean();

      if (affectedLedgers.length === 0) {
        console.log(`  No ledger entries to recalculate after deletion date`);
        continue;
      }

      console.log(
        `  Found ${affectedLedgers.length} ledger entries to recalculate`,
      );

      // Step 3: Delete all affected ledger entries (we'll recreate them with correct balances)
      await StockLedger.deleteMany({
        _id: { $in: affectedLedgers.map((l) => l._id) },
      });

      // Step 4: Find the last ledger entry BEFORE the earliest deletion date
      const previousLedger = await StockLedger.findOne({
        distributorId: new mongoose.Types.ObjectId(distributorId),
        productId: new mongoose.Types.ObjectId(productId),
        date: { $lt: new Date(earliestDate) },
      })
        .sort({ date: -1, _id: -1 })
        .lean();

      // Starting balances (from previous ledger or 0 if this is the first)
      let runningStock = previousLedger ? previousLedger.closingStock : 0;
      let runningPoints = previousLedger ? previousLedger.closingPoints : 0;

      console.log(
        `  Starting recalculation from stock: ${runningStock}, points: ${runningPoints}`,
      );

      // Step 5: Get product base_point for calculations
      const product = await Product.findById(productId).lean();
      if (!product) {
        console.error(`  Product not found: ${productId}`);
        continue;
      }
      const basePoints = product.base_point || 0;

      // Step 6: Fetch all transactions for affected ledger entries (still existing in DB)
      const affectedTransactionIds = affectedLedgers.map(
        (l) => l.transactionId,
      );
      const remainingTransactions = await Transaction.find({
        _id: { $in: affectedTransactionIds },
      })
        .sort({ date: 1, _id: 1 })
        .lean();

      console.log(
        `  Found ${remainingTransactions.length} transactions to rebuild ledger entries`,
      );

      // Step 7: Recalculate and create new ledger entries
      const newLedgerEntries = [];

      for (const transaction of remainingTransactions) {
        const openingStock = runningStock;
        const openingPoints = runningPoints;

        const qtyChange =
          transaction.type === "In" ? transaction.qty : -transaction.qty;
        const pointChange =
          transaction.type === "In"
            ? transaction.qty * basePoints
            : -(transaction.qty * basePoints);

        runningStock += qtyChange;
        runningPoints += pointChange;

        newLedgerEntries.push({
          distributorId: new mongoose.Types.ObjectId(distributorId),
          productId: new mongoose.Types.ObjectId(productId),
          transactionId: transaction._id,
          date: new Date(transaction.date),
          openingStock,
          openingPoints,
          transactionType: transaction.transactionType,
          qtyChange,
          pointChange,
          closingStock: runningStock,
          closingPoints: runningPoints,
        });
      }

      // Step 8: Insert recalculated entries
      if (newLedgerEntries.length > 0) {
        await StockLedger.insertMany(newLedgerEntries);
        totalRecalculated += newLedgerEntries.length;
        console.log(
          `  ✅ Recalculated ${newLedgerEntries.length} ledger entries`,
        );
        console.log(
          `  Final balances - Stock: ${runningStock}, Points: ${runningPoints}`,
        );
      }
    }

    console.log(
      `✅ Stock ledger recalculation complete: ${totalDeleted} deleted, ${totalRecalculated} recalculated for ${affectedCombinations.size} product(s)`,
    );

    return {
      success: true,
      deleted: totalDeleted,
      recalculated: totalRecalculated,
      affectedCombinations: affectedCombinations.size,
    };
  } catch (error) {
    console.error(
      "Error recalculating stock ledger after deletion:",
      error.message,
    );
    throw error;
  }
}

module.exports = {
  createStockLedgerEntry,
  createBulkStockLedgerEntries,
  recalculateStockLedgerAfterDeletion,
};
