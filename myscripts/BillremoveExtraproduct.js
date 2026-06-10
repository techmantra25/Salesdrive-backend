const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Bill = require("../models/bill.model");
const Transaction = require("../models/transaction.model");
const {
  recalculateStockLedgerAfterDeletion,
} = require("../controllers/transction/createStockLedgerEntry");

const MONGO_URI =
  "mongodb://DevTechMantra:TechMantra%23202603%21%40staging@localhost:27017/RupaDMS?authSource=admin";

const DEFAULT_INPUT = path.join(
  __dirname,
  "SellingBillMismatch_report_2026-05-05T17-22-29-822Z.json",
);

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const SKIP_STOCK_LEDGER = args.includes("--no-ledger");
const INPUT_FILE = args.includes("--input")
  ? args[args.indexOf("--input") + 1]
  : DEFAULT_INPUT;

function toObjectId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new mongoose.Types.ObjectId(value);
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

function loadReport() {
  const inputPath = path.resolve(process.cwd(), INPUT_FILE);
  const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const details = report.summary?.details || [];
  const mismatchDetails = details.flatMap((detail) =>
    (detail.mismatchDetails || []).map((mismatch) => ({
      ...mismatch,
      distributorId: detail.distributorId,
      distributor: detail.distributor,
      dbCode: detail.dbCode,
    })),
  );

  return { inputPath, mismatchDetails };
}

function getExpectedLineItemIdsByProduct(bill) {
  const map = new Map();

  for (const item of bill.lineItems || []) {
    const productId = item.product?.toString();
    if (!productId) continue;

    const itemBillType = String(item.itemBillType || "").toLowerCase();
    const isNonAdjustable =
      itemBillType === "item removed" ||
      itemBillType === "stock out" ||
      Number(item.billQty || 0) <= 0;

    if (isNonAdjustable) continue;

    if (!map.has(productId)) map.set(productId, new Set());
    map.get(productId).add(item._id.toString());
  }

  return map;
}

function chooseTransactionsToDelete(transactions, expectedLineItemIds, extraCount) {
  const sorted = [...transactions].sort((a, b) => {
    const aHasExpectedLine =
      a.billLineItemId && expectedLineItemIds.has(a.billLineItemId.toString());
    const bHasExpectedLine =
      b.billLineItemId && expectedLineItemIds.has(b.billLineItemId.toString());

    if (aHasExpectedLine !== bHasExpectedLine) {
      return aHasExpectedLine ? 1 : -1;
    }

    return new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0);
  });

  return sorted.slice(0, extraCount);
}

async function findProductDeliveryTransactions({
  distributorId,
  billId,
  billNo,
  productId,
  transactionIds,
}) {
  if (Array.isArray(transactionIds) && transactionIds.length > 0) {
    const reportTransactions = await Transaction.find({
      transactionId: { $in: transactionIds },
      productId,
      type: "Out",
      transactionType: "delivery",
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    if (reportTransactions.length > 0) {
      return reportTransactions;
    }
  }

  return Transaction.find({
    distributorId,
    productId,
    type: "Out",
    transactionType: "delivery",
    $or: [{ billId }, { description: getBillDescriptionRegex(billNo) }],
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
}

async function run() {
  const summary = {
    billsInReport: 0,
    billsWithExtraProducts: 0,
    extraProductRows: 0,
    plannedDeletes: 0,
    deletedTransactions: 0,
    stockLedgerRecalculated: 0,
    skipped: [],
    errors: [],
  };
  const transactionsToDelete = new Map();

  try {
    const { inputPath, mismatchDetails } = loadReport();
    summary.billsInReport = mismatchDetails.length;

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");
    console.log(`Input: ${inputPath}`);
    console.log(
      `Mode: ${WRITE_MODE ? "WRITE" : "DRY RUN"}${
        WRITE_MODE && !SKIP_STOCK_LEDGER ? " + STOCK LEDGER RECALC" : ""
      }`,
    );

    const mismatchesWithExtras = mismatchDetails.filter(
      (mismatch) => (mismatch.extraProducts || []).length > 0,
    );
    summary.billsWithExtraProducts = mismatchesWithExtras.length;

    for (const mismatch of mismatchesWithExtras) {
      const billId = toObjectId(mismatch.billId, "billId");
      const bill = await Bill.findById(billId)
        .select("_id billNo new_billno distributorId lineItems")
        .lean();

      if (!bill) {
        summary.skipped.push({
          billNo: mismatch.billNo,
          reason: `Bill not found: ${mismatch.billId}`,
        });
        continue;
      }

      const billNo = bill.new_billno || bill.billNo || mismatch.billNo;
      const distributorId = mismatch.distributorId || bill.distributorId;
      const lineItemIdsByProduct = getExpectedLineItemIdsByProduct(bill);

      for (const extraProduct of mismatch.extraProducts || []) {
        try {
          summary.extraProductRows++;

          const productId = toObjectId(extraProduct.productId, "productId");
          const extraCount = Number(extraProduct.extraCount || 0);

          if (extraCount <= 0) {
            summary.skipped.push({
              billNo,
              productCode: extraProduct.product_code,
              reason: `Invalid extraCount: ${extraProduct.extraCount}`,
            });
            continue;
          }

          const transactions = await findProductDeliveryTransactions({
            distributorId,
            billId: bill._id,
            billNo,
            productId,
            transactionIds: mismatch.transactionIds,
          });

          if (transactions.length === 0) {
            summary.skipped.push({
              billNo,
              productCode: extraProduct.product_code,
              reason: "No matching delivery transactions found",
            });
            continue;
          }

          const expectedLineItemIds =
            lineItemIdsByProduct.get(productId.toString()) || new Set();
          const selected = chooseTransactionsToDelete(
            transactions,
            expectedLineItemIds,
            extraCount,
          );

          if (selected.length < extraCount) {
            summary.skipped.push({
              billNo,
              productCode: extraProduct.product_code,
              reason: `Only found ${selected.length}/${extraCount} transactions to delete`,
            });
          }

          selected.forEach((transaction) => {
            transactionsToDelete.set(transaction._id.toString(), transaction);
          });

          console.log(
            `[PLAN] ${billNo} | ${extraProduct.product_code} | delete ${selected.length}/${extraCount}`,
          );
          selected.forEach((transaction) => {
            console.log(
              `  - ${transaction.transactionId || transaction._id} | lineItem ${transaction.billLineItemId || "N/A"} | qty ${transaction.qty}`,
            );
          });
        } catch (error) {
          summary.errors.push({
            billNo,
            productCode: extraProduct.product_code,
            reason: error.message,
          });
        }
      }
    }

    const deletedTransactions = Array.from(transactionsToDelete.values());
    summary.plannedDeletes = deletedTransactions.length;

    if (!WRITE_MODE) {
      console.log("\nDRY RUN: no transactions deleted.");
    } else if (deletedTransactions.length > 0) {
      const ids = deletedTransactions.map((transaction) => transaction._id);
      const deleteResult = await Transaction.deleteMany({ _id: { $in: ids } });
      summary.deletedTransactions = deleteResult.deletedCount;

      console.log(`\nDeleted ${deleteResult.deletedCount} transactions.`);

      if (!SKIP_STOCK_LEDGER) {
        const ledgerResult =
          await recalculateStockLedgerAfterDeletion(deletedTransactions);
        summary.stockLedgerRecalculated = ledgerResult.recalculated || 0;
      }
    }

    console.log("\nSummary");
    console.log(`Bills in report          : ${summary.billsInReport}`);
    console.log(`Bills with extra products: ${summary.billsWithExtraProducts}`);
    console.log(`Extra product rows       : ${summary.extraProductRows}`);
    console.log(`Planned deletes          : ${summary.plannedDeletes}`);
    console.log(`Deleted transactions     : ${summary.deletedTransactions}`);
    console.log(`Stock ledger recalculated: ${summary.stockLedgerRecalculated}`);
    console.log(`Skipped                  : ${summary.skipped.length}`);
    console.log(`Errors                   : ${summary.errors.length}`);

    if (summary.skipped.length) {
      console.log("\nSkipped items");
      summary.skipped.forEach((item) => {
        console.log(
          `- ${item.billNo} | ${item.productCode || "-"} | ${item.reason}`,
        );
      });
    }

    if (summary.errors.length) {
      console.log("\nErrors");
      summary.errors.forEach((item) => {
        console.log(
          `- ${item.billNo} | ${item.productCode || "-"} | ${item.reason}`,
        );
      });
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Fatal error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

run();
