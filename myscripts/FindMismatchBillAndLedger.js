/**
 * Script to fix transaction date mismatches with bill delivery dates
 *
 * Process:
 * 1. For each distributor, get their createdAt as start date, today as end date
 * 2. Find transactions where transaction.createdAt doesn't match bill.dates.deliveryDate (date-only)
 * 3. Match transactions with bills using billId or billNo (from transaction.description)
 * 4. Update BOTH transaction.date and transaction.createdAt to bill.dates.deliveryDate (full timestamp)
 * 5. Dry run first, then write to DB
 */

const mongoose = require("mongoose");

// Load models
const Distributor = require("../models/distributor.model");
const Bill = require("../models/bill.model");
const Transaction = require("../models/transaction.model");

// Configuration
const DRY_RUN = false; // Set to false to write changes to DB
const BATCH_SIZE = 500;
const TARGET_DB_CODE = "DPNE2601"; // Set to null to process all distributors

// Summary statistics
const summary = {
  totalDistributors: 0,
  processedDistributors: 0,
  totalTransactions: 0,
  totalMatches: 0,
  mismatches: 0,
  fixed: 0,
  errors: 0,
  details: [],
};

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect("mongodb://DevTechMantra:TechMantra%23202603%21%40staging@localhost:27017/RupaDMS?authSource=admin");
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
 * Find transactions for a distributor and fix date mismatches with bills
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
    // Fetch all "Out" delivery transactions for this distributor in the date range
    const transactions = await Transaction.find({
      distributorId,
      type: "Out",
      transactionType: "delivery",
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
      updates: [],
    };

    // Process transactions in batches
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);

      for (const transaction of batch) {
        let billData = null;
        let matchMethod = null;

        // Method 1: Match bill by billId
        if (transaction.billId) {
          billData = await Bill.findById(transaction.billId)
            .select("billNo dates.deliveryDate dates.originalDeliveryDate")
            .lean();
          if (billData) matchMethod = "billId";
        }

        // Method 2: Match bill by billNo parsed from description
        // Handles formats like: "Delivered against Bill: INV-25-26-000005" or "DJPR0000000127"
        if (!billData && transaction.description) {
          const billNoMatch =
            transaction.description.match(/Bill:\s*([\w\d-]+)/i);
          if (billNoMatch) {
            const billNo = billNoMatch[1];
            billData = await Bill.findOne({ billNo, distributorId })
              .select("billNo dates.deliveryDate dates.originalDeliveryDate")
              .lean();
            if (billData) matchMethod = "billNo (from description)";
          }
        }

        if (!billData) {
          console.log(`  ⚠ No bill found for transaction ${transaction._id}`);
          continue;
        }

        const billDeliveryDate = billData.dates?.deliveryDate;
        if (!billDeliveryDate) {
          console.log(`  ⚠ Bill ${billData.billNo} has no delivery date`);
          continue;
        }

        summary.totalMatches++;
        distributorDetails.matches++;

        // Compare transaction.createdAt (date-only) vs bill.dates.deliveryDate (date-only)
        // If they differ → update BOTH transaction.date and transaction.createdAt
        // to the full billDeliveryDate timestamp
        if (!isSameDate(transaction.createdAt, billDeliveryDate)) {
          summary.mismatches++;
          distributorDetails.mismatches++;

          const update = {
            transactionId: transaction._id,
            billNo: billData.billNo,
            matchMethod,
            oldDate: transaction.date,
            oldCreatedAt: transaction.createdAt,
            // Both date and createdAt will be replaced with full bill delivery timestamp
            newDate: billDeliveryDate,
            newCreatedAt: billDeliveryDate,
          };

          updates.push(update);
          distributorDetails.updates.push(update);

          console.log(`  📝 Mismatch found for transaction ${transaction._id}`);
          console.log(
            `     Bill: ${billData.billNo} | Match via: ${matchMethod}`,
          );
          console.log(
            `     Old date      : ${new Date(transaction.date).toISOString()}`,
          );
          console.log(
            `     New date      : ${new Date(billDeliveryDate).toISOString()}`,
          );
          console.log(
            `     Old createdAt : ${new Date(transaction.createdAt).toISOString()}`,
          );
          console.log(
            `     New createdAt : ${new Date(billDeliveryDate).toISOString()}`,
          );
        }
      }
    }

    // Apply updates if not in dry run mode
    if (updates.length > 0 && !DRY_RUN) {
      console.log(`\n💾 Applying ${updates.length} updates...`);

      for (const update of updates) {
        try {
          await Transaction.updateOne(
            { _id: update.transactionId },
            {
              $set: {
                date: update.newDate,
                createdAt: update.newCreatedAt, // Full timestamp from billDeliveryDate
              },
            },
            { timestamps: false }, // Bypass Mongoose auto-managed createdAt
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
  console.log(`Matched with Bills          : ${summary.totalMatches}`);
  console.log(`Date Mismatches Found       : ${summary.mismatches}`);
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

      if (detail.updates && detail.updates.length > 0) {
        console.log(`   Updates      : ${detail.updates.length}`);
        detail.updates.slice(0, 5).forEach((update) => {
          console.log(`     • Bill ${update.billNo} [${update.matchMethod}]`);
          console.log(
            `       date      : ${new Date(update.oldDate).toISOString()} → ${new Date(update.newDate).toISOString()}`,
          );
          console.log(
            `       createdAt : ${new Date(update.oldCreatedAt).toISOString()} → ${new Date(update.newCreatedAt).toISOString()}`,
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
║          Transaction-Bill Date Mismatch Reconciliation Script              ║
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
