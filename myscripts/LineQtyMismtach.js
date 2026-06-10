/**
 * Script to find bill delivery quantity mismatches.
 *
 * Example:
 * Bill line item billQty = 10, but related delivery transaction qty = 20.
 *
 * Process:
 * 1. For each distributor (or TARGET_DB_CODE), find delivered/partially delivered bills
 * 2. Find related delivery transactions by billId and billNo description
 * 3. Compare bill line-item/product quantities with transaction quantities
 * 4. Write a JSON report with mismatch details
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
  billsWithQtyMismatches: 0,
  totalLineItems: 0,
  totalTransactions: 0,
  totalQtyDifference: 0,
  errors: 0,
  details: [],
};

const productCache = new Map();

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
    log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

async function closeDB() {
  try {
    await mongoose.disconnect();
    log("Disconnected from MongoDB");
  } catch (error) {
    console.error("Error disconnecting from MongoDB:", error.message);
  }
}

async function getAllDistributors() {
  const distributors = await Distributor.find({ status: true }).select(
    "_id name dbCode",
  );
  log(`\nFound ${distributors.length} active distributors\n`);
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

function addToMapArray(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function sumQty(items) {
  return items.reduce((total, item) => total + Number(item.qty || 0), 0);
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

async function getProductsMap(productIds) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const missingProductIds = uniqueProductIds.filter((id) => !productCache.has(id));

  if (missingProductIds.length > 0) {
    const products = await Product.find({ _id: { $in: missingProductIds } })
      .select("product_code name")
      .lean();

    products.forEach((product) => {
      productCache.set(product._id.toString(), product);
    });

    missingProductIds.forEach((productId) => {
      if (!productCache.has(productId)) {
        productCache.set(productId, null);
      }
    });
  }

  return new Map(
    uniqueProductIds.map((productId) => [
      productId,
      productCache.get(productId) || {},
    ]),
  );
}

async function buildQtyMismatchDetail(bill, transactions) {
  const lineItems = getAdjustableItems(bill);
  const transactionsByLineItem = new Map();
  const transactionsByProduct = new Map();
  const lineItemsByProduct = new Map();

  lineItems.forEach((lineItem) => {
    addToMapArray(lineItemsByProduct, lineItem.product?.toString(), lineItem);
  });

  transactions.forEach((transaction) => {
    addToMapArray(
      transactionsByLineItem,
      transaction.billLineItemId?.toString(),
      transaction,
    );
    addToMapArray(
      transactionsByProduct,
      transaction.productId?.toString(),
      transaction,
    );
  });

  const productIds = [
    ...new Set([
      ...lineItems.map((item) => item.product?.toString()).filter(Boolean),
      ...transactions.map((tx) => tx.productId?.toString()).filter(Boolean),
    ]),
  ];
  const productMap = await getProductsMap(productIds);

  const lineItemQtyMismatches = [];
  const productQtyMismatches = [];

  for (const lineItem of lineItems) {
    const lineItemId = lineItem._id.toString();
    const productId = lineItem.product?.toString();
    const product = productMap.get(productId) || {};
    const expectedQty = Number(lineItem.billQty || 0);
    let matchedTransactions = transactionsByLineItem.get(lineItemId) || [];
    let matchMethod = "billLineItemId";

    if (matchedTransactions.length === 0) {
      const productLineItems = lineItemsByProduct.get(productId) || [];
      if (productLineItems.length === 1) {
        matchedTransactions = transactionsByProduct.get(productId) || [];
        matchMethod = "productId-single-line";
      }
    }

    const transactionQty = sumQty(matchedTransactions);

    if (matchedTransactions.length > 0 && expectedQty !== transactionQty) {
      lineItemQtyMismatches.push({
        lineItemId,
        productId,
        product_code: product.product_code || "unknown",
        product_name: product.name || "unknown",
        billQty: expectedQty,
        transactionQty,
        difference: expectedQty - transactionQty,
        matchMethod,
        transactions: matchedTransactions.map((transaction) => ({
          transactionId: transaction.transactionId,
          transactionObjectId: transaction._id,
          qty: transaction.qty,
          billLineItemId: transaction.billLineItemId || null,
          matchMethod: transaction.__matchMethod,
        })),
      });
    }
  }

  const productIdsToCheck = [
    ...new Set([
      ...Array.from(lineItemsByProduct.keys()),
      ...Array.from(transactionsByProduct.keys()),
    ]),
  ].filter(Boolean);

  for (const productId of productIdsToCheck) {
    const productLineItems = lineItemsByProduct.get(productId) || [];
    const product = productMap.get(productId) || {};
    const expectedQty = productLineItems.reduce(
      (total, item) => total + Number(item.billQty || 0),
      0,
    );
    const productTransactions = transactionsByProduct.get(productId) || [];
    const transactionQty = sumQty(productTransactions);

    if (expectedQty !== transactionQty) {
      productQtyMismatches.push({
        productId,
        product_code: product.product_code || "unknown",
        product_name: product.name || "unknown",
        billQty: expectedQty,
        transactionQty,
        difference: expectedQty - transactionQty,
        lineItemsCount: productLineItems.length,
        transactionCount: productTransactions.length,
        lineItemIds: productLineItems.map((item) => item._id.toString()),
        transactionIds: productTransactions.map((transaction) => transaction.transactionId),
      });
    }
  }

  return {
    billNo: bill.billNo,
    billId: bill._id,
    status: bill.status,
    createdAt: bill.createdAt,
    deliveryDate: bill.dates?.deliveryDate || null,
    lineItemsCount: lineItems.length,
    transactionCount: transactions.length,
    lineItemQtyMismatches,
    productQtyMismatches,
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
    billsWithQtyMismatches: 0,
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
    log(`Found ${bills.length} delivered/partially delivered bills`);

    for (const bill of bills) {
      const lineItemsCount = getAdjustableItems(bill).length;
      summary.totalLineItems += lineItemsCount;

      const transactions = await findDeliveryTransactions(distributorId, bill);
      summary.totalTransactions += transactions.length;

      if (lineItemsCount === 0 && transactions.length === 0) continue;

      const mismatchDetail = await buildQtyMismatchDetail(bill, transactions);
      const hasMismatch =
        mismatchDetail.lineItemQtyMismatches.length > 0 ||
        mismatchDetail.productQtyMismatches.length > 0;

      if (!hasMismatch) continue;

      summary.billsWithQtyMismatches++;
      distributorDetails.billsWithQtyMismatches++;
      distributorDetails.mismatchDetails.push(mismatchDetail);

      const totalDifference = mismatchDetail.productQtyMismatches.reduce(
        (total, item) => total + Math.abs(item.difference),
        0,
      );
      summary.totalQtyDifference += totalDifference;

      warn(`  Qty mismatch found for Bill ${bill.billNo}`);
      mismatchDetail.productQtyMismatches.slice(0, 5).forEach((item) => {
        warn(
          `     ${item.product_code} | billQty: ${item.billQty}, transactionQty: ${item.transactionQty}`,
        );
      });
    }
  } catch (error) {
    console.error(`Error processing distributor ${name}:`, error.message);
    summary.errors++;
    distributorDetails.status = "Error: " + error.message;
  } finally {
    summary.processedDistributors++;
    summary.details.push(distributorDetails);
  }

  log(`  Processed ${bills.length} bills`);
  log(`  Qty mismatches found: ${distributorDetails.billsWithQtyMismatches}`);
}

function printSummary() {
  log(`\n${"=".repeat(80)}`);
  log("BILL QTY VS DELIVERY TRANSACTION QTY MISMATCH REPORT");
  log(`${"=".repeat(80)}`);
  log(`Mode                         : ${DRY_RUN ? "REPORT ONLY" : "WRITE MODE"}`);
  log(
    `Distributors Processed        : ${summary.processedDistributors}/${summary.totalDistributors}`,
  );
  log(`Total Bills Processed         : ${summary.totalBills}`);
  log(`Total Line Items Counted      : ${summary.totalLineItems}`);
  log(`Total Transactions Counted    : ${summary.totalTransactions}`);
  log(`Bills with Qty Mismatches     : ${summary.billsWithQtyMismatches}`);
  log(`Total Qty Difference          : ${summary.totalQtyDifference}`);
  log(`Errors                        : ${summary.errors}`);
  log(`${"=".repeat(80)}\n`);

  summary.details.forEach((detail, index) => {
    if (detail.status) {
      log(`\n${index + 1}. ${detail.distributor || "Unknown"} - ${detail.status}`);
      return;
    }

    log(`\n${index + 1}. ${detail.distributor || "Unknown"} (${detail.dbCode})`);
    log(`   Total Bills: ${detail.totalBills}`);
    log(`   Bills with Qty Mismatches: ${detail.billsWithQtyMismatches}`);

    if (detail.mismatchDetails.length > 0) {
      log("   Top 5 Qty Mismatches:");
      detail.mismatchDetails.slice(0, 5).forEach((mismatch) => {
        const firstProduct = mismatch.productQtyMismatches[0];
        log(
          `     Bill ${mismatch.billNo}: ${firstProduct.product_code} billQty ${firstProduct.billQty} vs transactionQty ${firstProduct.transactionQty}`,
        );
      });
    }
  });
}

function writeJSONReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = OUTPUT_FILE || `LineQtyMismtach_report_${timestamp}.json`;
  const filepath = path.isAbsolute(filename)
    ? filename
    : path.join(__dirname, filename);

  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    targetDbCode: TARGET_DB_CODE,
    billStatuses: BILL_STATUSES,
    summary,
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\nJSON report saved to: ${filepath}`);
  } catch (error) {
    console.error(`Failed to write JSON report: ${error.message}`);
  }
}

async function main() {
  log(`
========================================================================
        Bill Qty vs Delivery Transaction Qty Mismatch Script
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
        `\nNo distributor found${TARGET_DB_CODE ? ` with dbCode: ${TARGET_DB_CODE}` : ""}\n`,
      );
      process.exitCode = 1;
      return;
    }

    for (const distributor of filteredDistributors) {
      await processDistributorBills(distributor);
    }

    printSummary();
    writeJSONReport();
  } catch (error) {
    console.error("Fatal error:", error.message);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
}

main();
