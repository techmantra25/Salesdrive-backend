const mongoose = require("mongoose");

// Models
const Distributor = require("../models/distributor.model");
const Invoice = require("../models/invoice.model");
const Transaction = require("../models/transaction.model");

// Config
const DRY_RUN = false;
const BATCH_SIZE = 1000;
const TARGET_DB_CODE = "DJPR7001";

// Summary
const summary = {
  totalTransactions: 0,
  matched: 0,
  mismatches: 0,
  updated: 0,
  qtyMismatches: 0,
  countMismatches: 0,
};

/**
 * DB CONNECT
 */
async function connectDB() {
  await mongoose.connect(
    "mongodb://DevTechMantra:TechMantra%23202603%21%40staging@localhost:27017/RupaDMS?authSource=admin"
  );
  console.log("✓ MongoDB Connected");
}

/**
 * Merge DATE (invoice) + TIME (transaction)
 */
function mergeDateAndTime(transactionDate, invoiceDate) {
  const t = new Date(transactionDate);
  const i = new Date(invoiceDate);

  return new Date(
    i.getFullYear(),
    i.getMonth(),
    i.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
    t.getMilliseconds()
  );
}

/**
 * Compare only date
 */
function isSameDate(a, b) {
  return (
    new Date(a).toISOString().slice(0, 10) ===
    new Date(b).toISOString().slice(0, 10)
  );
}

/**
 * MAIN PROCESS
 */
async function processDistributor(distributor) {
  console.log(`\n🚀 Processing ${distributor.name} (${distributor.dbCode})`);

  const transactions = await Transaction.find({
    distributorId: distributor._id,
    type: "In",
    transactionType: "invoice",
  }).lean();

  summary.totalTransactions += transactions.length;
  console.log(`📦 Transactions: ${transactions.length}`);

  if (!transactions.length) return;

  // 🔥 STEP 1: Collect invoiceIds
  const invoiceIds = [
    ...new Set(
      transactions
        .map((t) => t.invoiceId)
        .filter(Boolean)
        .map((id) => id.toString())
    ),
  ];

  // 🔥 STEP 2: Fetch invoices with lineItems
  const invoices = await Invoice.find({
    _id: { $in: invoiceIds },
  })
    .select("_id grnDate invoiceNo lineItems")
    .lean();

  // 🔥 STEP 3: Map invoices
  const invoiceMap = new Map();
  invoices.forEach((inv) => {
    invoiceMap.set(inv._id.toString(), inv);
  });

  // 🔥 STEP 4: Group transactions per invoice
  const txGrouped = new Map();

  transactions.forEach((tx) => {
    const key = tx.invoiceId?.toString();
    if (!key) return;

    if (!txGrouped.has(key)) {
      txGrouped.set(key, []);
    }
    txGrouped.get(key).push(tx);
  });

  const bulkOps = [];

  /**
   * 🔥 PROCESS EACH INVOICE GROUP
   */
  for (const [invoiceId, txList] of txGrouped.entries()) {
    const invoice = invoiceMap.get(invoiceId);
    if (!invoice) continue;

    // ✅ COUNT CHECK
    if (txList.length !== invoice.lineItems.length) {
      summary.countMismatches++;

      console.log(
        `❌ COUNT MISMATCH | Invoice: ${invoice.invoiceNo} | TX: ${txList.length} | Items: ${invoice.lineItems.length}`
      );
    }

    // 🔥 Create lineItem map
    const lineItemMap = new Map();
    invoice.lineItems.forEach((li) => {
      lineItemMap.set(li._id.toString(), li);
    });

    /**
     * 🔥 LOOP TRANSACTIONS
     */
    for (const tx of txList) {
      if (!invoice.grnDate) continue;

      summary.matched++;

      // ✅ DATE FIX
      if (!isSameDate(tx.date, invoice.grnDate)) {
        summary.mismatches++;

        const newDate = mergeDateAndTime(tx.date, invoice.grnDate);

        bulkOps.push({
          updateOne: {
            filter: { _id: tx._id },
            update: {
              $set: {
                date: newDate,
                createdAt: newDate,
                updatedAt: newDate,
              },
            },
          },
        });

        console.log(
          `📝 DATE FIX | ${invoice.invoiceNo} | ${tx._id}`
        );
      }

      // ✅ QTY CHECK
      const lineItem = lineItemMap.get(
        tx.invoiceLineItemId?.toString()
      );

      if (lineItem && tx.qty !== lineItem.receivedQty) {
        summary.qtyMismatches++;

        console.log(
          `❌ QTY MISMATCH | Invoice: ${invoice.invoiceNo} | TX QTY: ${tx.qty} | INV QTY: ${lineItem.receivedQty}`
        );
      }

      // 🔥 BULK EXEC
      if (bulkOps.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          const res = await Transaction.bulkWrite(bulkOps);
          summary.updated += res.modifiedCount;
        }
        bulkOps.length = 0;
      }
    }
  }

  // 🔥 FINAL BULK
  if (bulkOps.length && !DRY_RUN) {
    const res = await Transaction.bulkWrite(bulkOps);
    summary.updated += res.modifiedCount;
  }
}

/**
 * MAIN
 */
async function main() {
  try {
    await connectDB();

    const distributors = await Distributor.find({ status: true }).select(
      "_id name dbCode"
    );

    const filtered = TARGET_DB_CODE
      ? distributors.filter((d) => d.dbCode === TARGET_DB_CODE)
      : distributors;

    for (const distributor of filtered) {
      await processDistributor(distributor);
    }

    console.log("\n========== SUMMARY ==========");
    console.log("Total Transactions :", summary.totalTransactions);
    console.log("Matched            :", summary.matched);
    console.log("Date Mismatches    :", summary.mismatches);
    console.log("Qty Mismatches     :", summary.qtyMismatches);
    console.log("Count Mismatches   :", summary.countMismatches);
    console.log("Updated            :", summary.updated);
    console.log("=============================\n");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("✓ DB Disconnected");
  }
}

main();