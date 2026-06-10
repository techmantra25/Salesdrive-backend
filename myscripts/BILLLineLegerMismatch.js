/**
 * Script to track mismatches between bill line items count and delivery transaction count.
 *
 * Process:
 * 1. For each distributor (or single target distributor), find delivered bills
 * 2. For each bill, count bill line items and related delivery transactions
 * 3. Report mismatches where transaction count is not equal to line item count
 * 4. Include missingProducts and extraProducts in the JSON report
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const OUTPUT_JSON = args.includes("--json");
const OUTPUT_FILE = args.includes("--output")
  ? args[args.indexOf("--output") + 1]
  : null;
const SILENT = OUTPUT_JSON;

const Distributor = require("../models/distributor.model");
const Bill = require("../models/bill.model");
const Transaction = require("../models/transaction.model");
const Product = require("../models/product.model");

const DRY_RUN = true;
const TARGET_DB_CODE = "DJPR4301"; // Set to null to process all distributors
const BILL_STATUSES = ["Delivered", "Partially-Delivered"];

const summary = {
  totalDistributors: 0,
  processedDistributors: 0,
  totalBills: 0,
  billsWithMismatches: 0,
  totalLineItems: 0,
  totalTransactions: 0,
  mismatchedTransactions: 0,
  errors: 0,
  details: [],
};

function log(...messages) {
  if (!SILENT) console.log(...messages);
}

function warn(...messages) {
  if (!SILENT) console.warn(...messages);
}

async function connectDB() {
  try {
    await mongoose.connect(
      "mongodb://DevTechMantra:TechMantra%23202603%21%40staging@localhost:27017/RupaDMS?authSource=admin",
    );
    log("✓ Connected to MongoDB");
  } catch (error) {
    console.error("✗ MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

async function closeDB() {
  try {
    await mongoose.disconnect();
    log("✓ Disconnected from MongoDB");
  } catch (error) {
    console.error("✗ Error disconnecting from MongoDB:", error.message);
  }
}

async function getAllDistributors() {
  const distributors = await Distributor.find({ status: true }).select(
    "_id name dbCode",
  );
  log(`\n📊 Found ${distributors.length} active distributors\n`);
  return distributors;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBillDescriptionRegex(billNo) {
  const escapedBillNo = escapeRegExp(billNo);
  return new RegExp(
    `Delivered\\s+against\\s+Bill:?\\s*${escapedBillNo}(?![A-Za-z0-9-])`,
    "i",
  );
}

function isNonAdjustableItem(item) {
  const itemBillType = String(item.itemBillType || "").toLowerCase();
  return (
    itemBillType === "item removed" ||
    itemBillType === "stock out" ||
    Number(item.billQty || 0) <= 0
  );
}

function getAdjustableItems(bill) {
  return (bill.lineItems || []).filter((item) => !isNonAdjustableItem(item));
}

function getSkippedLineItems(bill) {
  return (bill.lineItems || [])
    .filter((item) => isNonAdjustableItem(item))
    .map((item) => ({
      lineItemId: item._id?.toString(),
      productId: item.product?.toString(),
      billQty: item.billQty,
      itemBillType: item.itemBillType || null,
      reason:
        Number(item.billQty || 0) <= 0
          ? "Zero billQty"
          : `Non-adjustable itemBillType: ${item.itemBillType}`,
    }));
}

async function findDeliveryTransactions(distributorId, bill) {
  const billIdTransactions = await Transaction.find({
    distributorId,
    billId: bill._id,
    type: "Out",
    transactionType: "delivery",
  }).lean();

  let descriptionTransactions = [];
  if (bill.billNo) {
    descriptionTransactions = await Transaction.find({
      distributorId,
      description: getBillDescriptionRegex(bill.billNo),
      type: "Out",
      transactionType: "delivery",
    }).lean();
  }

  const transactionsById = new Map();
  billIdTransactions.forEach((transaction) => {
    transactionsById.set(transaction._id.toString(), {
      ...transaction,
      __matchMethod: "billId",
    });
  });
  descriptionTransactions.forEach((transaction) => {
    const transactionId = transaction._id.toString();
    if (!transactionsById.has(transactionId)) {
      transactionsById.set(transactionId, {
        ...transaction,
        __matchMethod: "description",
      });
    }
  });

  return Array.from(transactionsById.values());
}

function incrementMap(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

async function buildMismatchDetail(bill, transactions) {
  const adjustableItems = getAdjustableItems(bill);
  const lineItemProductCounts = new Map();
  const transactionProductCounts = new Map();
  const lineItemProductMap = new Map();
  const transactionLineItemIds = new Set();

  for (const lineItem of adjustableItems) {
    const productId = lineItem.product?.toString();
    const lineItemId = lineItem._id?.toString();

    incrementMap(lineItemProductCounts, productId);
    if (lineItemId && productId) {
      lineItemProductMap.set(lineItemId, productId);
    }
  }

  for (const transaction of transactions) {
    let productId = transaction.productId?.toString();

    if (transaction.billLineItemId) {
      const lineItemId = transaction.billLineItemId.toString();
      transactionLineItemIds.add(lineItemId);

      if (!productId) {
        productId = lineItemProductMap.get(lineItemId);
      }
    }

    incrementMap(transactionProductCounts, productId);
  }

  const productIds = [
    ...new Set([
      ...Array.from(lineItemProductCounts.keys()),
      ...Array.from(transactionProductCounts.keys()),
    ]),
  ];
  const products = await Product.find({ _id: { $in: productIds } })
    .select("product_code name")
    .lean();
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const existingTransactionIds = [
    ...new Set(
      transactions.filter((t) => t.transactionId).map((t) => t.transactionId),
    ),
  ];

  const missingProducts = adjustableItems
    .filter((lineItem) => {
      const productId = lineItem.product?.toString();
      const lineItemId = lineItem._id?.toString();

      if (lineItemId && transactionLineItemIds.has(lineItemId)) {
        return false;
      }

      return (
        productId &&
        (transactionProductCounts.get(productId) || 0) <
          (lineItemProductCounts.get(productId) || 0)
      );
    })
    .map((lineItem) => {
      const productId = lineItem.product?.toString();
      const product = productMap.get(productId) || {};

      return {
        lineItemId: lineItem._id.toString(),
        productId,
        product_code: product.product_code || "unknown",
        product_name: product.name || "unknown",
        billQty: lineItem.billQty,
        orderQty: lineItem.oderQty,
        inventoryId: lineItem.inventoryId?.toString() || null,
        "Adj. No":
          existingTransactionIds.length > 0
            ? existingTransactionIds.join(", ")
            : "N/A",
      };
    });

  const extraProducts = Array.from(transactionProductCounts.entries())
    .filter(
      ([productId, count]) =>
        productId && count > (lineItemProductCounts.get(productId) || 0),
    )
    .map(([productId, count]) => {
      const product = productMap.get(productId) || {};
      const lineItemsCount = lineItemProductCounts.get(productId) || 0;

      return {
        productId,
        product_code: product.product_code || "unknown",
        product_name: product.name || "unknown",
        lineItemsCount,
        transactionCount: count,
        extraCount: count - lineItemsCount,
      };
    });

  return {
    billNo: bill.billNo,
    billId: bill._id,
    status: bill.status,
    lineItemsCount: adjustableItems.length,
    rawLineItemsCount: bill.lineItems ? bill.lineItems.length : 0,
    transactionCount: transactions.length,
    difference: adjustableItems.length - transactions.length,
    createdAt: bill.createdAt,
    deliveryDate: bill.dates?.deliveryDate || null,
    skippedLineItems: getSkippedLineItems(bill),
    missingProducts,
    extraProducts,
    transactionIds: transactions
      .filter((transaction) => transaction.transactionId)
      .map((transaction) => transaction.transactionId),
    matchMethods: {
      billId: transactions.filter((transaction) => transaction.__matchMethod === "billId")
        .length,
      description: transactions.filter(
        (transaction) => transaction.__matchMethod === "description",
      ).length,
    },
  };
}

async function processDistributorBills(distributor) {
  const { _id: distributorId, name, dbCode } = distributor;

  log(`\n${"=".repeat(80)}`);
  log(`Processing: ${name} (${dbCode}) | ID: ${distributorId}`);
  log(`${"=".repeat(80)}`);

  let bills = [];
  const distributorDetails = {
    distributor: name,
    distributorId,
    dbCode,
    totalBills: 0,
    billsWithMismatches: 0,
    mismatchDetails: [],
  };

  try {
    bills = await Bill.find({
      distributorId,
      status: { $in: BILL_STATUSES },
    })
      .select("_id billNo status lineItems dates createdAt")
      .lean();

    summary.totalBills += bills.length;
    distributorDetails.totalBills = bills.length;
    log(`📄 Found ${bills.length} delivered/partially delivered bills`);

    if (bills.length === 0) {
      distributorDetails.status = "No delivered bills";
      return;
    }

    for (const bill of bills) {
      const lineItemsCount = getAdjustableItems(bill).length;
      summary.totalLineItems += lineItemsCount;

      const transactions = await findDeliveryTransactions(distributorId, bill);
      const transactionCount = transactions.length;
      summary.totalTransactions += transactionCount;

      if (lineItemsCount !== transactionCount) {
        summary.billsWithMismatches++;
        summary.mismatchedTransactions += Math.abs(
          lineItemsCount - transactionCount,
        );
        distributorDetails.billsWithMismatches++;

        const mismatchDetail = await buildMismatchDetail(bill, transactions);
        distributorDetails.mismatchDetails.push(mismatchDetail);

        warn(`  ⚠ Mismatch found for Bill ${bill.billNo}`);
        warn(
          `     Line Items: ${lineItemsCount}, Transactions: ${transactionCount}`,
        );
        warn(`     Difference: ${lineItemsCount - transactionCount}`);

        if (mismatchDetail.missingProducts.length > 0) {
          warn(`     Missing Products (${mismatchDetail.missingProducts.length}):`);
          mismatchDetail.missingProducts.slice(0, 5).forEach((item) => {
            warn(
              `       - ${item.product_code} | ${item.product_name} | billQty: ${item.billQty}`,
            );
          });
        }

        if (mismatchDetail.extraProducts.length > 0) {
          warn(`     Extra Products (${mismatchDetail.extraProducts.length}):`);
          mismatchDetail.extraProducts.slice(0, 5).forEach((item) => {
            warn(
              `       - ${item.product_code} | ${item.product_name} | extra transactions: ${item.extraCount}`,
            );
          });
        }
      }
    }
  } catch (error) {
    console.error(`✗ Error processing distributor ${name}:`, error.message);
    summary.errors++;
    distributorDetails.status = "Error: " + error.message;
  } finally {
    summary.processedDistributors++;
    summary.details.push(distributorDetails);
  }

  log(`  ✓ Processed ${bills.length} bills`);
  log(`  ✓ Mismatches found: ${distributorDetails.billsWithMismatches}`);
}

function printSummary() {
  log(`\n${"=".repeat(80)}`);
  log("BILL LINE ITEMS VS DELIVERY TRANSACTIONS MISMATCH REPORT");
  log(`${"=".repeat(80)}`);
  log(`Mode                         : ${DRY_RUN ? "REPORT ONLY" : "WRITE MODE"}`);
  log(
    `Distributors Processed        : ${summary.processedDistributors}/${summary.totalDistributors}`,
  );
  log(`Total Bills Processed         : ${summary.totalBills}`);
  log(`Total Line Items Counted      : ${summary.totalLineItems}`);
  log(`Total Transactions Counted    : ${summary.totalTransactions}`);
  log(`Bills with Mismatches         : ${summary.billsWithMismatches}`);
  log(`Total Mismatched Transactions : ${summary.mismatchedTransactions}`);
  log(`Errors                        : ${summary.errors}`);
  log(`${"=".repeat(80)}\n`);

  summary.details.forEach((detail, index) => {
    if (detail.status) {
      log(`\n${index + 1}. ${detail.distributor || "Unknown"} - ${detail.status}`);
      return;
    }

    log(`\n${index + 1}. ${detail.distributor || "Unknown"} (${detail.dbCode})`);
    log(`   Total Bills: ${detail.totalBills}`);
    log(`   Bills with Mismatches: ${detail.billsWithMismatches}`);

    if (detail.mismatchDetails.length > 0) {
      log("   Top 5 Mismatches:");
      detail.mismatchDetails.slice(0, 5).forEach((m) => {
        const diffText =
          m.difference > 0
            ? `+${m.difference} extra line items`
            : `${Math.abs(m.difference)} extra transactions`;
        log(
          `     • Bill ${m.billNo}: ${m.lineItemsCount} items vs ${m.transactionCount} transactions (${diffText})`,
        );
      });
    }
  });
}

function writeJSONReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `BILLLineLegerMismatch_report_${timestamp}.json`;
  const filepath = path.join(__dirname, filename);

  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    targetDbCode: TARGET_DB_CODE,
    summary: summary,
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\n📁 JSON report saved to: ${filepath}`);
  } catch (error) {
    console.error(`✗ Failed to write JSON report: ${error.message}`);
  }
}

async function main() {
  log(`
========================================================================
        Bill Line Items vs Delivery Transactions Counter Script
========================================================================
`);

  try {
    await connectDB();

    const distributors = await getAllDistributors();
    summary.totalDistributors = distributors.length;

    const filteredDistributors = TARGET_DB_CODE
      ? distributors.filter((d) => d.dbCode === TARGET_DB_CODE)
      : distributors;

    if (filteredDistributors.length === 0) {
      console.error(
        `\n✗ No distributor found${TARGET_DB_CODE ? ` with dbCode: ${TARGET_DB_CODE}` : ""}\n`,
      );
      process.exitCode = 1;
      return;
    }

    if (TARGET_DB_CODE) {
      log(
        `\n🎯 Processing single distributor: ${filteredDistributors[0].name} (${filteredDistributors[0].dbCode})\n`,
      );
    } else {
      log(`\n🎯 Processing all ${filteredDistributors.length} distributors\n`);
    }

    for (const distributor of filteredDistributors) {
      await processDistributorBills(distributor);
    }

    printSummary();
    writeJSONReport();
  } catch (error) {
    console.error("✗ Fatal error:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
}

main();
