/**
 * Script to track mismatches between 
sales return line items count and 
transaction count
 *
 * Process:
 * 1. For each distributor (or single 
target distributor), find all sales 
returns
 * 2. For each sales return, count line 
items and count related transactions
 * 3. Report mismatches where 
transaction count ≠ line item count
 * 4. Provide detailed summary report
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
const SalesReturn = require("../models/salesReturn.model");
const Transaction = require("../models/transaction.model");
const Product = require("../models/product.model");

// Configuration
const DRY_RUN = true; // Set to false to actually make any changes (if we add fixing logic later)
const TARGET_DB_CODE = "DJPR4301"; // Set to null to process all distributors

// Summary statistics
const summary = {
  totalDistributors: 0,
  processedDistributors: 0,
  totalSalesReturns: 0,
  salesReturnsWithMismatches: 0,
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
 * Process sales returns for a 
distributor and count line items vs 
transactions
 */
async function processDistributorSalesReturns(distributor) {
  const { _id: distributorId, name, dbCode } = distributor;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Processing: ${name} (${dbCode}) | ID: ${distributorId}`);
  console.log(`${"=".repeat(80)}`);

  let salesReturns = [];
  const distributorDetails = {
    distributor: name,
    distributorId,
    dbCode,
    totalSalesReturns: 0,
    salesReturnsWithMismatches: 0,
    mismatchDetails: [],
  };

  try {
    // Fetch all sales returns for this distributor
    salesReturns = await SalesReturn.find({ distributorId })
      .select("_id salesReturnNo lineItems createdAt")
      .lean();

    summary.totalSalesReturns += salesReturns.length;
    console.log(`📄 Found ${salesReturns.length} sales returns`);

    if (salesReturns.length === 0) {
      distributorDetails.status = "No sales returns";
      summary.processedDistributors++;
      summary.details.push(distributorDetails);
      return;
    }

    distributorDetails.totalSalesReturns = salesReturns.length;

    // Process each sales return
    for (const sr of salesReturns) {
      const lineItemsCount = sr.lineItems ? sr.lineItems.length : 0;
      summary.totalLineItems += lineItemsCount;

      // Count transactions for this sales return (only search by description since billId may not be present)
      let transactions = await Transaction.find({
        distributorId,
        transactionType: "salesreturn",
        description: new RegExp(`Sales Return for ${sr.salesReturnNo}`, 'i'),
        type: "In",
      }).lean();

      const transactionCount = transactions.length;
      summary.totalTransactions += transactionCount;

      // Check for mismatch
      if (lineItemsCount !== transactionCount) {
        summary.salesReturnsWithMismatches++;
        summary.mismatchedTransactions += Math.abs(lineItemsCount - transactionCount);
        distributorDetails.salesReturnsWithMismatches++;

        const fullSR = await SalesReturn.findById(sr._id).lean();
        const lineProductCounts = new Map();
        const transactionProductCounts = new Map();

        fullSR.lineItems.forEach(li => {
          const productId = li.product?.toString();
          if (productId) {
            lineProductCounts.set(productId, (lineProductCounts.get(productId) || 0) + 1);
          }
        });

        transactions.forEach(t => {
          const productId = t.productId?.toString();
          if (productId) {
            transactionProductCounts.set(productId, (transactionProductCounts.get(productId) || 0) + 1);
          }
        });

        const productIds = [
          ...new Set([
            ...Array.from(lineProductCounts.keys()),
            ...Array.from(transactionProductCounts.keys()),
          ]),
        ];
        const products = await Product.find({ _id: { $in: productIds } }).select("product_code name").lean();
        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        const missingProducts = fullSR.lineItems
          .filter(li => {
            const productId = li.product?.toString();
            return productId && (transactionProductCounts.get(productId) || 0) < (lineProductCounts.get(productId) || 0);
          })
          .map(li => {
            const product = productMap.get(li.product?.toString()) || {};
            return {
              lineItemId: li._id.toString(),
              productId: li.product?.toString(),
              product_code: product.product_code || "unknown",
              product_name: product.name || "unknown",
              qty: li.billQty,
              returnQty: li.returnQty,
            };
          });

        const extraProducts = Array.from(transactionProductCounts.entries())
          .filter(([productId, count]) => count > (lineProductCounts.get(productId) || 0))
          .map(([productId, count]) => {
            const product = productMap.get(productId) || {};
            return {
              productId,
              product_code: product.product_code || "unknown",
              product_name: product.name || "unknown",
              lineItemsCount: lineProductCounts.get(productId) || 0,
              transactionCount: count,
              extraCount: count - (lineProductCounts.get(productId) || 0),
            };
          });

        const mismatchDetail = {
          salesReturnNo: sr.salesReturnNo,
          salesReturnId: sr._id,
          lineItemsCount,
          transactionCount,
          difference: lineItemsCount - transactionCount,
          createdAt: sr.createdAt,
          missingProducts: missingProducts,
          extraProducts: extraProducts,
        };

        distributorDetails.mismatchDetails.push(mismatchDetail);

        console.log(`  ⚠ Mismatch found for SR ${sr.salesReturnNo}`);
        console.log(`     Line Items: ${lineItemsCount}, Transactions: ${transactionCount}`);
        console.log(`     Difference: ${lineItemsCount - transactionCount}`);
        if (missingProducts.length > 0) {
          console.log(`     Missing Products (${missingProducts.length}):`);
          missingProducts.slice(0, 5).forEach(li => {
            console.log(`       - ${li.product_code} | ${li.product_name} | billQty: ${li.qty} | returnQty: ${li.returnQty}`);
          });
        }
        if (extraProducts.length > 0) {
          console.log(`     Extra Products (${extraProducts.length}):`);
          extraProducts.slice(0, 5).forEach(product => {
            console.log(`       - ${product.product_code} | ${product.product_name} | extra transactions: ${product.extraCount}`);
          });
        }
      }
    }
  } catch (error) {
    console.error(`✗ Error processing distributor ${name}:`, error.message);
    summary.errors++;
    distributorDetails.status = "Error: " + error.message;
  }

  summary.processedDistributors++;
  summary.details.push(distributorDetails);
  console.log(`  ✓ Processed ${salesReturns.length} sales returns`);
  console.log(`  ✓ Mismatches found: ${distributorDetails.salesReturnsWithMismatches}`);
}

/**
 * Print final summary report
 */
function printSummary() {
  console.log(`\n${"=".repeat(80)}`);
  console.log("SALES RETURN LINE ITEMS VS TRANSACTIONS MISMATCH REPORT");
  console.log(`${"=".repeat(80)}`);
  console.log(`Mode                         : ${DRY_RUN ? "🔍 REPORT ONLY (No changes)" : "💾 WRITE MODE"}`);
  console.log(`Distributors Processed        : ${summary.processedDistributors}/${summary.totalDistributors}`);
  console.log(`Total Sales Returns Processed : ${summary.totalSalesReturns}`);
  console.log(`Total Line Items Counted      : ${summary.totalLineItems}`);
  console.log(`Total Transactions Counted    : ${summary.totalTransactions}`);
  console.log(`Sales Returns with Mismatches : ${summary.salesReturnsWithMismatches}`);
  console.log(`Total Mismatched Transactions : ${summary.mismatchedTransactions}`);
  console.log(`Errors                        : ${summary.errors}`);
  console.log(`${"=".repeat(80)}\n`);

  console.log("DETAILED DISTRIBUTOR REPORT:");
  console.log(`${"=".repeat(80)}`);

  summary.details.forEach((detail, index) => {
    if (detail.status) {
      console.log(`\n${index + 1}. ${detail.distributor || "Unknown"} - ${detail.status}`);
    } else {
      console.log(`\n${index + 1}. ${detail.distributor || "Unknown"} (${detail.dbCode})`);
      console.log(`   Total Sales Returns: ${detail.totalSalesReturns}`);
      console.log(`   Sales Returns with Mismatches: ${detail.salesReturnsWithMismatches}`);

      if (detail.mismatchDetails.length > 0) {
        console.log(`   Top 5 Mismatches:`);
        detail.mismatchDetails.slice(0, 5).forEach(m => {
          const diffText = m.difference > 0 ? `+${m.difference} extra line items` : `${Math.abs(m.difference)} extra transactions`;
          console.log(`     • SR ${m.salesReturnNo}: ${m.lineItemsCount} items vs ${m.transactionCount} transactions (${diffText})`);
        });
      }
    }
  });
}

/**
 * Write JSON report to file
 */
function writeJSONReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `SalesReturnLineItemsFind_report_${timestamp}.json`;
  const filepath = path.join(__dirname, filename);

  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    targetDbCode: TARGET_DB_CODE,
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
  ║        Sales Return Line Items vs Transactions Counter Script              ║
  ║${DRY_RUN ? "                         🔍 REPORT ONLY MODE                          " : "                         💾 WRITE MODE                                "}║
  ╚════════════════════════════════════════════════════════════════════════════╝
  `);

  try {
    await connectDB();

    const distributors = await getAllDistributors();
    summary.totalDistributors = distributors.length;

    const filteredDistributors = TARGET_DB_CODE
      ? distributors.filter((d) => d.dbCode === TARGET_DB_CODE)
      : distributors;

    if (filteredDistributors.length === 0) {
      console.log(`\n✗ No distributor found${TARGET_DB_CODE ? ` with dbCode: ${TARGET_DB_CODE}` : ""}\n`);
      await closeDB();
      process.exit(1);
    }

    for (const distributor of filteredDistributors) {
      await processDistributorSalesReturns(distributor);
    }

    printSummary();
    writeJSONReport();

  } catch (error) {
    console.error("✗ Fatal error:", error.message);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

main().catch(console.error);
