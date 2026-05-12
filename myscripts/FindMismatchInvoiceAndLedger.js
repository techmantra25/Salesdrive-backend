/**
 * Script to find and fix date mismatches between invoice grnDate and transaction date
 *
 * Process:
 * 1. For each distributor, get their createdAt as start date, today as end date
 * 2. Find transactions where transaction.date doesn't match invoice.grnDate (date-only)
 * 3. Match transactions with invoices using invoiceId
 * 4. Update transaction.date to invoice.grnDate (date part)
 * 5. Dry run first, then write to DB
 */

const mongoose = require("mongoose");

// Load models
const Distributor = require("../models/distributor.model");
const Invoice = require("../models/invoice.model");
const Transaction = require("../models/transaction.model");

// Configuration
const DRY_RUN = false; // Set to false to write changes to DB
const BATCH_SIZE = 500;
const TARGET_DB_CODE = "DJPR4301"; // Set to null to process all distributors

// Summary statistics
const summary = {
  totalDistributors: 0,
  processedDistributors: 0,
  totalTransactions: 0,
  totalMatches: 0,
  mismatches: 0,
  fixed: 0,
  errors: 0,
  lineItemMismatches: 0,
  lineItemQtyMismatches: 0,
  details: [],
};

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect("mongodb://rupaAdmin:admin2025@127.0.0.1:27017/rupadms?authSource=rupadms");
    console.log("✓ Connected to MongoDB");
  } catch (error) {
    console.error("✗ MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

/**
 * Close MongoDB connection
 */
async function closeDB() {
  try {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  } catch (error) {
    console.error("✗ Error disconnecting from MongoDB:", error.message);
  }
}

/**
 * Get all active distributors
 */
async function getAllDistributors() {
  try {
    const distributors = await Distributor.find({ status: true }).select(
      "_id name dbCode createdAt",
    );
    console.log(`\n📊 Found ${distributors.length} active distributors\n`);
    return distributors;
  } catch (error) {
    console.error("✗ Error fetching distributors:", error.message);
    throw error;
  }
}

/**
 * Compare only the date part (YYYY-MM-DD) of two Date objects, ignoring time
 */
function isSameDate(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Find transactions for a distributor and fix date mismatches with invoices
 */
async function processDistributorTransactions(distributor) {
  const { _id: distributorId, name, dbCode, createdAt } = distributor;
  const startDate = new Date(createdAt);
  const endDate = new Date(); // Today

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Processing: ${name} (${dbCode}) | ID: ${distributorId}`);
  console.log(
    `Date Range: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`,
  );
  console.log(`${"=".repeat(80)}`);

  try {
    // Fetch all "In" invoice transactions for this distributor in the date range
    const transactions = await Transaction.find({
      distributorId,
      type: "In",
      transactionType: "invoice",
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    summary.totalTransactions += transactions.length;
    console.log(`📦 Found ${transactions.length} transactions`);

    if (transactions.length === 0) {
      summary.details.push({
        distributor: name,
        transactions: 0,
        status: "No transactions",
      });
      return;
    }

    const updates = [];
    const distributorDetails = {
      distributor: name,
      distributorId,
      startDate,
      endDate,
      transactionCount: transactions.length,
      matches: 0,
      mismatches: 0,
      lineItemMismatches: 0,
      lineItemQtyMismatches: 0,
      updates: [],
    };

    // Map to track invoice line items vs transaction count
    const invoiceLineItemMap = new Map();

    // Process transactions in batches
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);

      for (const transaction of batch) {
        let invoiceData = null;

        // Match invoice by invoiceId
        if (transaction.invoiceId) {
          invoiceData = await Invoice.findById(transaction.invoiceId)
            .select("invoiceNo grnDate lineItems")
            .lean();
        }

        // Method 2: Match invoice by invoiceNo parsed from description
        // Handles formats like: "Invoice 170193345 - Stock received"
        if (!invoiceData && transaction.description) {
          const invoiceNoMatch = transaction.description.match(/Invoice\s+(\d+)/i);
          if (invoiceNoMatch) {
            const invoiceNo = invoiceNoMatch[1];
            invoiceData = await Invoice.findOne({ invoiceNo, distributorId })
              .select("invoiceNo grnDate lineItems")
              .lean();
          }
        }

        if (!invoiceData) {
          console.log(`  ⚠ No invoice found for transaction ${transaction._id}`);
          if (transaction.description) {
            console.log(`     Description: ${transaction.description}`);
          }
          continue;
        }

        const invoiceGrnDate = invoiceData.grnDate;
        if (!invoiceGrnDate) {
          console.log(`  ⚠ Invoice ${invoiceData.invoiceNo} has no grnDate`);
          continue;
        }

        summary.totalMatches++;
        distributorDetails.matches++;

        // Check line item qty mismatch
        if (transaction.invoiceLineItemId && invoiceData.lineItems) {
          const lineItem = invoiceData.lineItems.find(li => li._id.toString() === transaction.invoiceLineItemId.toString());
          if (lineItem && lineItem.receivedQty !== transaction.qty) {
            console.log(`  📝 Line item qty mismatch for transaction ${transaction._id}: receivedQty ${lineItem.receivedQty}, transaction qty ${transaction.qty}`);
            summary.lineItemQtyMismatches++;
            distributorDetails.lineItemQtyMismatches++;
          }
        }

        // Update line item count map
        const invoiceIdStr = invoiceData._id.toString();
        if (!invoiceLineItemMap.has(invoiceIdStr)) {
          invoiceLineItemMap.set(invoiceIdStr, {
            lineItemsCount: invoiceData.lineItems ? invoiceData.lineItems.length : 0,
            transactionCount: 0,
            invoiceNo: invoiceData.invoiceNo,
          });
        }
        invoiceLineItemMap.get(invoiceIdStr).transactionCount++;

        // Compare transaction.date (date-only) vs invoice.grnDate (date-only)
        // If they differ → update transaction.date to invoiceGrnDate
        if (!isSameDate(transaction.date, invoiceGrnDate)) {
          summary.mismatches++;
          distributorDetails.mismatches++;

          const update = {
            transactionId: transaction._id,
            invoiceNo: invoiceData.invoiceNo,
            oldDate: transaction.date,
            newDate: invoiceGrnDate,
          };

          updates.push(update);
          distributorDetails.updates.push(update);

          console.log(`  📝 Mismatch found for transaction ${transaction._id}`);
          console.log(`     Invoice: ${invoiceData.invoiceNo}`);
          console.log(
            `     Old date: ${new Date(transaction.date).toISOString()}`,
          );
          console.log(
            `     New date: ${new Date(invoiceGrnDate).toISOString()}`,
          );
        }
      }
    }

    // Check for line item count mismatches
    for (const [invoiceId, data] of invoiceLineItemMap) {
      if (data.lineItemsCount === 5 && data.transactionCount !== 5) {
        console.log(`  📝 Line item mismatch for invoice ${data.invoiceNo}: ${data.lineItemsCount} line items, ${data.transactionCount} transactions`);
        summary.lineItemMismatches++;
        distributorDetails.lineItemMismatches++;
      }
    }

    // Apply updates if not in dry run mode
    // Commented out for now to just see the differences
    
    if (updates.length > 0 && !DRY_RUN) {
      console.log(`\n💾 Applying ${updates.length} updates...`);

      for (const update of updates) {
        try {
          await Transaction.updateOne(
            { _id: update.transactionId },
            {
              $set: {
                date: update.newDate,
              },
            },
          );
          summary.fixed++;
          console.log(`  ✓ Updated transaction ${update.transactionId}`);
        } catch (error) {
          console.error(
            `  ✗ Failed to update transaction ${update.transactionId}:`,
            error.message,
          );
          summary.errors++;
        }
      }
    } else if (updates.length > 0 && DRY_RUN) {
      console.log(`\n🔍 DRY RUN: ${updates.length} updates would be applied`);
    }
    

    summary.processedDistributors++;
    summary.details.push(distributorDetails);
  } catch (error) {
    console.error(`✗ Error processing distributor ${name}:`, error.message);
    summary.errors++;
  }
}

/**
 * Print final summary report
 */
function printSummary() {
  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY REPORT");
  console.log(`${"=".repeat(80)}`);
  console.log(
    `Mode                        : ${DRY_RUN ? "🔍 DRY RUN (No changes made)" : "💾 WRITE MODE (Changes applied)"}`,
  );
  console.log(
    `Distributors Processed      : ${summary.processedDistributors}/${summary.totalDistributors}`,
  );
  console.log(`Total Transactions Processed: ${summary.totalTransactions}`);
  console.log(`Matched with Invoices       : ${summary.totalMatches}`);
  console.log(`Date Mismatches Found       : ${summary.mismatches}`);
  console.log(`Line Item Mismatches Found   : ${summary.lineItemMismatches}`);
  console.log(`Line Item Qty Mismatches     : ${summary.lineItemQtyMismatches}`);
  console.log(`Updates Applied             : ${summary.fixed}`);
  console.log(`Errors                      : ${summary.errors}`);
  console.log(`${"=".repeat(80)}\n`);

  console.log("DISTRIBUTOR DETAILS:");
  console.log(`${"=".repeat(80)}`);

  summary.details.forEach((detail) => {
    console.log(`\n📦 ${detail.distributor || "Unknown"}`);
    if (detail.status) {
      console.log(`   Status: ${detail.status}`);
    } else {
      console.log(`   Transactions : ${detail.transactionCount}`);
      console.log(`   Matched      : ${detail.matches}`);
      console.log(`   Mismatches   : ${detail.mismatches}`);
      console.log(`   Line Item Mismatches: ${detail.lineItemMismatches}`);
      console.log(`   Line Item Qty Mismatches: ${detail.lineItemQtyMismatches}`);

      if (detail.updates && detail.updates.length > 0) {
        console.log(`   Updates      : ${detail.updates.length}`);
        detail.updates.slice(0, 5).forEach((update) => {
          console.log(`     • Invoice ${update.invoiceNo}`);
          console.log(
            `       date: ${new Date(update.oldDate).toISOString()} → ${new Date(update.newDate).toISOString()}`,
          );
        });
        if (detail.updates.length > 5) {
          console.log(`     ... and ${detail.updates.length - 5} more`);
        }
      }
    }
  });

  console.log(`\n${"=".repeat(80)}`);
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║          Transaction-Invoice GRN Date Mismatch Reconciliation Script         ║
║${DRY_RUN ? "                         🔍 DRY RUN MODE                              " : "                         💾 WRITE MODE                               "}║
╚════════════════════════════════════════════════════════════════════════════╝
  `);

  try {
    await connectDB();

    const distributors = await getAllDistributors();
    summary.totalDistributors = distributors.length;

    // Filter by TARGET_DB_CODE if set, otherwise process all
    const filteredDistributors = TARGET_DB_CODE
      ? distributors.filter((d) => d.dbCode === TARGET_DB_CODE)
      : distributors;

    if (filteredDistributors.length === 0) {
      console.log(
        `\n✗ No distributor found${TARGET_DB_CODE ? ` with dbCode: ${TARGET_DB_CODE}` : ""}\n`,
      );
      await closeDB();
      process.exit(1);
    }

    if (TARGET_DB_CODE) {
      console.log(
        `\n🎯 Processing single distributor: ${filteredDistributors[0].name} (${filteredDistributors[0].dbCode})\n`,
      );
    } else {
      console.log(
        `\n🎯 Processing all ${filteredDistributors.length} distributors\n`,
      );
    }

    for (const distributor of filteredDistributors) {
      await processDistributorTransactions(distributor);
    }

    printSummary();

    if (summary.mismatches > 0 && DRY_RUN) {
      console.log("\n📋 NEXT STEPS:");
      console.log("   1. Review the mismatches above");
      console.log("   2. If everything looks correct, set DRY_RUN = false");
      console.log(
        "   3. Run the script again to apply updates to the database",
      );
      console.log("   4. Verify the updates were applied correctly\n");
    }

    if (!DRY_RUN && summary.fixed > 0) {
      console.log(
        `\n✓ Successfully updated ${summary.fixed} transactions in the database\n`,
      );
    }
  } catch (error) {
    console.error("✗ Fatal error:", error.message);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

main().catch(console.error);