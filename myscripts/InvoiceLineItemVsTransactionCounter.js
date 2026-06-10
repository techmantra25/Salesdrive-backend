/**
 * Script to track mismatches between invoice line items count and transaction count
 *
 * Process:
 * 1. For each distributor (or single target distributor), find all invoices
 * 2. For each invoice, count line items and count related transactions
 * 3. Report mismatches where transaction count ≠ line item count
 * 4. Optionally flag invoices with 5 line items specifically (as seen in original script)
 * 5. Provide detailed summary report
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// Command line arguments
const args = process.argv.slice(2);
const OUTPUT_JSON = args.includes('--json');
const OUTPUT_FILE = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
const SILENT = OUTPUT_JSON; // If JSON output, suppress console logs

// Load models
const Distributor = require("../models/distributor.model");
const Invoice = require("../models/invoice.model");
const Transaction = require("../models/transaction.model");
const Product = require("../models/product.model");

// Configuration
const DRY_RUN = true; // Set to false to actually make any changes (if we add fixing logic later)
const TARGET_DB_CODE = "DDMP0302"; // Set to null to process all distributors
const SPECIFIC_LINE_ITEM_COUNT = 5; // Flag invoices with this specific line item count (as in original script)

// Summary statistics
const summary = {
  totalDistributors: 0,
  processedDistributors: 0,
  totalInvoices: 0,
  invoicesWithMismatches: 0,
  invoicesWith5ItemsAndMismatch: 0,
  totalLineItems: 0,
  totalTransactions: 0,
  mismatchedTransactions: 0,
  errors: 0,
  details: [],
};

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    // Use staging DB from .env
    await mongoose.connect(
      "mongodb://rupaAdmin:admin2025@127.0.0.1:27017/rupadms?authSource=rupadms"
    );
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
      "_id name dbCode"
    );
    console.log(`\n📊 Found ${distributors.length} active distributors\n`);
    return distributors;
  } catch (error) {
    console.error("✗ Error fetching distributors:", error.message);
    throw error;
  }
}

/**
 * Process invoices for a distributor and count line items vs transactions
 */
async function processDistributorInvoices(distributor) {
  const { _id: distributorId, name, dbCode } = distributor;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Processing: ${name} (${dbCode}) | ID: ${distributorId}`);
  console.log(`${"=".repeat(80)}`);

  // Initialize variables outside try block so they're always defined
  let invoices = [];
  const distributorDetails = {
    distributor: name,
    distributorId,
    dbCode,
    totalInvoices: 0,
    invoicesWithMismatches: 0,
    invoicesWith5ItemsAndMismatch: 0,
    mismatchDetails: [],
  };

  try {
    // Fetch all invoices for this distributor (only Confirmed status)
    invoices = await Invoice.find({ distributorId, status: "Confirmed" })
      .select("_id invoiceNo lineItems createdAt")
      .lean();

    summary.totalInvoices += invoices.length;
    console.log(`📄 Found ${invoices.length} invoices`);

    if (invoices.length === 0) {
      distributorDetails.status = "No invoices";
      summary.processedDistributors++;
      summary.details.push(distributorDetails);
      return;
    }

    distributorDetails.totalInvoices = invoices.length;

    // Process each invoice
    for (const invoice of invoices) {
      const lineItemsCount = invoice.lineItems ? invoice.lineItems.length : 0;
      summary.totalLineItems += lineItemsCount;

      // Count transactions for this invoice by invoiceId
      let transactions = await Transaction.find({
        distributorId,
        invoiceId: invoice._id,
        type: "In",
        transactionType: "invoice",
      }).lean();

      // Method 2: Also find transactions where invoiceNo is parsed from description
      // Handles formats like: "Invoice 170193345 - Stock received"
      if (transactions.length === 0 && invoice.invoiceNo) {
        const invoicePattern = new RegExp(`Invoice\\s+${invoice.invoiceNo}`, 'i');
        const descTransactions = await Transaction.find({
          distributorId,
          description: invoicePattern,
          type: "In",
          transactionType: "invoice",
        }).lean();

        if (descTransactions.length > 0) {
          transactions = descTransactions;
        }
      }

      const transactionCount = transactions.length;
      summary.totalTransactions += transactionCount;

      // Check for mismatch
      if (lineItemsCount !== transactionCount) {
        summary.invoicesWithMismatches++;
        summary.mismatchedTransactions += Math.abs(lineItemsCount - transactionCount);
        distributorDetails.invoicesWithMismatches++;

        // Get full invoice with lineItems
        const fullInvoice = await Invoice.findById(invoice._id).lean();

        // Fetch product details separately for all line items
        const productIds = fullInvoice.lineItems.map(li => li.product);
        const products = await Product.find({ _id: { $in: productIds } }).select("product_code name").lean();
        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        // Build set of productIds that have transactions (match by productId OR invoiceLineItemId)
        const matchedProductIds = new Set();

        // Also build map of lineItemId -> productId from transactions
        const lineItemToProductMap = new Map();
        transactions.forEach(t => {
          if (t.productId) {
            matchedProductIds.add(t.productId.toString());
            lineItemToProductMap.set(t._id.toString(), t.productId.toString());
          }
        });

        // Also check transactions matched by invoiceLineItemId - get their products
        // We need to re-fetch invoice to get lineItem->product mapping
        const lineItemProductMap = new Map();
        fullInvoice.lineItems.forEach(li => {
          lineItemProductMap.set(li._id.toString(), li.product?.toString());
        });

        // For transactions that have invoiceLineItemId, add that line item's product
        transactions.forEach(t => {
          if (t.invoiceLineItemId) {
            const productId = lineItemProductMap.get(t.invoiceLineItemId.toString());
            if (productId) {
              matchedProductIds.add(productId);
            }
          }
        });

        // Find line items whose product is NOT in any transaction
        // Collect existing unique transactionIds from transactions (to use as Adj. No reference)
        const existingTransactionIds = [...new Set(
          transactions
            .filter(t => t.transactionId)
            .map(t => t.transactionId)
        )];

        const missingProducts = fullInvoice.lineItems
          .filter(li => {
            const productId = li.product?.toString();
            return productId && !matchedProductIds.has(productId);
          })
          .map(li => {
            const product = productMap.get(li.product?.toString()) || {};
            return {
              lineItemId: li._id.toString(),
              productId: li.product?.toString(),
              product_code: product.product_code || "unknown",
              product_name: product.name || "unknown",
              qty: li.qty,
              receivedQty: li.receivedQty,
              "Adj. No": existingTransactionIds.length > 0 ? existingTransactionIds.join(", ") : "N/A",
            };
          });

        const mismatchDetail = {
          invoiceNo: invoice.invoiceNo,
          invoiceId: invoice._id,
          lineItemsCount,
          transactionCount,
          difference: lineItemsCount - transactionCount,
          createdAt: invoice.createdAt,
          missingProducts: missingProducts,
        };

        distributorDetails.mismatchDetails.push(mismatchDetail);

        // Check for specific line item count (e.g., 5)
        if (lineItemsCount === SPECIFIC_LINE_ITEM_COUNT) {
          summary.invoicesWith5ItemsAndMismatch++;
          distributorDetails.invoicesWith5ItemsAndMismatch++;
        }

        console.log(`  ⚠ Mismatch found for invoice ${invoice.invoiceNo}`);
        console.log(`     Line Items: ${lineItemsCount}, Transactions: ${transactionCount}`);
        console.log(`     Difference: ${lineItemsCount - transactionCount}`);
        if (missingProducts.length > 0) {
          console.log(`     Missing Products (${missingProducts.length}):`);
          missingProducts.slice(0, 5).forEach(li => {
            console.log(`       - ${li.product_code} | ${li.product_name} | qty: ${li.qty} | receivedQty: ${li.receivedQty}`);
          });
          if (missingProducts.length > 5) {
            console.log(`       ... and ${missingProducts.length - 5} more`);
          }
        }

        // Show some transaction details if available
        if (transactions.length > 0) {
          console.log(`     Sample transaction IDs: ${transactions.slice(0, 3).map(t => t._id.toString().substring(0, 8)).join(', ')}...`);
        }
      }
    }

    // Outside try block so these execute even on error
  } catch (error) {
    console.error(`✗ Error processing distributor ${name}:`, error.message);
    summary.errors++;
    distributorDetails.status = "Error: " + error.message;
  }

  // Always update summary and push details, regardless of success or error
  summary.processedDistributors++;
  summary.details.push(distributorDetails);

  console.log(`  ✓ Processed ${invoices.length} invoices`);
  console.log(`  ✓ Mismatches found: ${distributorDetails.invoicesWithMismatches}`);
  if (distributorDetails.invoicesWith5ItemsAndMismatch > 0) {
    console.log(`  ✓ Invoices with ${SPECIFIC_LINE_ITEM_COUNT} items and mismatch: ${distributorDetails.invoicesWith5ItemsAndMismatch}`);
  }
}

/**
 * Print final summary report
 */
function printSummary() {
  console.log(`\n${"=".repeat(80)}`);
  console.log("INVOICE LINE ITEMS VS TRANSACTIONS MISMATCH REPORT");
  console.log(`${"=".repeat(80)}`);
  console.log(`Mode                               : ${DRY_RUN ? "🔍 REPORT ONLY (No changes)" : "💾 WRITE MODE"}`);
  console.log(`Distributors Processed             : ${summary.processedDistributors}/${summary.totalDistributors}`);
  console.log(`Total Invoices Processed           : ${summary.totalInvoices}`);
  console.log(`Total Line Items Counted           : ${summary.totalLineItems}`);
  console.log(`Total Transactions Counted         : ${summary.totalTransactions}`);
  console.log(`Invoices with Mismatches          : ${summary.invoicesWithMismatches}`);
  console.log(`Invoices with ${SPECIFIC_LINE_ITEM_COUNT} Items & Mismatch : ${summary.invoicesWith5ItemsAndMismatch}`);
  console.log(`Total Mismatched Transactions      : ${summary.mismatchedTransactions}`);
  console.log(`Errors                             : ${summary.errors}`);
  console.log(`${"=".repeat(80)}\n`);

  console.log("DETAILED DISTRIBUTOR REPORT:");
  console.log(`${"=".repeat(80)}`);

  summary.details.forEach((detail, index) => {
    if (detail.status) {
      console.log(`\n${index + 1}. ${detail.distributor || "Unknown"} - ${detail.status}`);
    } else {
      console.log(`\n${index + 1}. ${detail.distributor || "Unknown"} (${detail.dbCode})`);
      console.log(`   Total Invoices: ${detail.totalInvoices}`);
      console.log(`   Invoices with Mismatches: ${detail.invoicesWithMismatches}`);
      if (detail.invoicesWith5ItemsAndMismatch > 0) {
        console.log(`   Invoices with ${SPECIFIC_LINE_ITEM_COUNT} Items & Mismatch: ${detail.invoicesWith5ItemsAndMismatch}`);
      }

      if (detail.mismatchDetails.length > 0) {
        console.log(`   Top 5 Mismatches:`);
        detail.mismatchDetails.slice(0, 5).forEach(m => {
          const diffText = m.difference > 0 ? `+${m.difference} extra line items` : `${Math.abs(m.difference)} extra transactions`;
          console.log(`     • Invoice ${m.invoiceNo}: ${m.lineItemsCount} items vs ${m.transactionCount} transactions (${diffText})`);
        });
        if (detail.mismatchDetails.length > 5) {
          console.log(`     ... and ${detail.mismatchDetails.length - 5} more`);
        }
      }
    }
  });

  console.log(`\n${"=".repeat(80)}`);
  console.log("ANALYSIS:");
  console.log(`${"=".repeat(80)}`);

  if (summary.invoicesWithMismatches === 0) {
    console.log("✅ No mismatches found. All invoices have matching transaction counts.");
  } else {
    console.log("⚠️  MISMATCHES DETECTED:");
    console.log("\nPossible causes:");
    console.log("1. Transactions may not have been created for all line items");
    console.log("2. Transactions may have been created but later deleted");
    console.log("3. Line items may have been added/removed after transaction creation");
    console.log("4. Duplicate transactions may exist");
    console.log("5. Transactions may reference wrong invoiceId");

    console.log("\nNext steps:");
    console.log("1. Review detailed mismatch list above");
    console.log("2. Check specific invoices with high mismatch counts");
    console.log("3. Investigate transaction creation logic");
    console.log("4. Consider running reconciliation script to fix issues");
  }

  console.log(`\n${"=".repeat(80)}`);
}

/**
 * Write JSON report to file
 */
function writeJSONReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `InvoiceLineItemVsTransactionCounter_report_${timestamp}.json`;
  const filepath = path.join(__dirname, filename);

  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    targetDbCode: TARGET_DB_CODE,
    specificLineItemCount: SPECIFIC_LINE_ITEM_COUNT,
    summary: summary
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\n📁 JSON report saved to: ${filepath}`);
  } catch (error) {
    console.error(`✗ Failed to write JSON report: ${error.message}`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║        Invoice Line Items vs Transactions Counter Script                  ║
║${DRY_RUN ? "                         🔍 REPORT ONLY MODE                              " : "                         💾 WRITE MODE                               "}║
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
      await processDistributorInvoices(distributor);
    }

    printSummary();
    writeJSONReport();

    if (summary.invoicesWithMismatches > 0 && DRY_RUN) {
      console.log("\n📋 NEXT STEPS:");
      console.log("   1. Review the mismatch report above");
      console.log("   2. Investigate specific invoices with problems");
      console.log("   3. Consider fixing by:");
      console.log("      a) Running the full reconciliation script");
      console.log("      b) Manually checking transaction creation logic");
      console.log("      c) Updating DRY_RUN = false and adding fix logic here");
      console.log("   4. Verify any fixes with this script again\n");
    }

  } catch (error) {
    console.error("✗ Fatal error:", error.message);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

main().catch(console.error);