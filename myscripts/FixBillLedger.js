const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Bill = require("../models/bill.model");
const Transaction = require("../models/transaction.model");
const Inventory = require("../models/inventory.model");
const { transactionCode } = require("../utils/codeGenerator");
const {
  createStockLedgerEntry,
} = require("../controllers/transction/createStockLedgerEntry");

const MONGO_URI =
  "mongodb://DevTechMantra:TechMantra%23202603%21%40staging@localhost:27017/RupaDMS?authSource=admin";

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const SKIP_STOCK_LEDGER = args.includes("--no-ledger");
const INPUT_FILE = args.includes("--input")
  ? args[args.indexOf("--input") + 1]
  : null;

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

function getLatestReportFile() {
  const files = fs
    .readdirSync(__dirname)
    .filter((file) => /^SellingBillMismatch_report_.*\.json$/i.test(file))
    .map((file) => {
      const filepath = path.join(__dirname, file);
      return {
        file,
        filepath,
        mtimeMs: fs.statSync(filepath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files.length) {
    throw new Error(
      "No SellingBillMismatch_report_*.json file found. Pass --input <file>.",
    );
  }

  return files[0].filepath;
}

function loadReport() {
  const inputPath = INPUT_FILE
    ? path.resolve(process.cwd(), INPUT_FILE)
    : getLatestReportFile();

  const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const mismatchDetails = (report.summary?.details || []).flatMap((detail) =>
    Array.isArray(detail.mismatchDetails) ? detail.mismatchDetails : [],
  );

  if (!mismatchDetails.length) {
    throw new Error(`No mismatchDetails found in ${inputPath}`);
  }

  return { inputPath, report, mismatchDetails };
}

function getTransactionDate(bill, mismatchDetail) {
  return (
    bill.dates?.deliveryDate ||
    mismatchDetail.deliveryDate ||
    bill.createdAt ||
    new Date()
  );
}

function getOriginalDeliveryDate(bill, transactionDate) {
  return bill.dates?.originalDeliveryDate || transactionDate;
}

async function existingDeliveryTransaction({
  distributorId,
  billId,
  lineItemId,
  billNo,
  productId,
}) {
  return Transaction.findOne({
    distributorId,
    transactionType: "delivery",
    type: "Out",
    productId,
    $or: [
      { billId, billLineItemId: lineItemId },
      { billId, billLineItemId: { $exists: false } },
      { billId, billLineItemId: null },
      { description: getBillDescriptionRegex(billNo) },
      {
        description: getBillDescriptionRegex(billNo),
        billLineItemId: lineItemId,
      },
    ],
  }).lean();
}

function sameObjectId(left, right) {
  if (!left || !right) return false;
  return left.toString() === right.toString();
}

function needsBillLink(transaction, billId, lineItemId) {
  return (
    !sameObjectId(transaction.billId, billId) ||
    !sameObjectId(transaction.billLineItemId, lineItemId)
  );
}

async function linkExistingTransaction({
  transaction,
  billId,
  lineItemId,
  transactionDate,
  originalDeliveryDate,
  enabledBackDate,
}) {
  await Transaction.updateOne(
    { _id: transaction._id },
    {
      $set: {
        billId,
        billLineItemId: lineItemId,
        dates: {
          deliveryDate: transactionDate,
          originalDeliveryDate,
        },
        enabledBackDate,
      },
    },
  );
}

async function run() {
  const summary = {
    billsInReport: 0,
    prepared: 0,
    inserted: 0,
    linkedExisting: 0,
    ledgerCreated: 0,
    skipped: [],
    errors: [],
  };

  try {
    const { inputPath, mismatchDetails } = loadReport();
    summary.billsInReport = mismatchDetails.length;

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");
    console.log(`Input: ${inputPath}`);
    console.log(
      `Mode: ${WRITE_MODE ? "WRITE" : "DRY RUN"}${
        WRITE_MODE && !SKIP_STOCK_LEDGER ? " + STOCK LEDGER" : ""
      }`,
    );

    for (const mismatchDetail of mismatchDetails) {
      const billId = toObjectId(mismatchDetail.billId, "billId");
      const bill = await Bill.findById(billId)
        .select(
          "distributorId billNo new_billno status lineItems dates enabledBackDate createdAt",
        )
        .lean();

      if (!bill) {
        summary.skipped.push({
          billNo: mismatchDetail.billNo,
          reason: `Bill not found: ${mismatchDetail.billId}`,
        });
        continue;
      }

      const billNo = bill.new_billno || bill.billNo || mismatchDetail.billNo;
      const finalBillId = toObjectId(bill._id, "billId");
      const distributorId = bill.distributorId;
      const transactionDate = getTransactionDate(bill, mismatchDetail);
      const originalDeliveryDate = getOriginalDeliveryDate(
        bill,
        transactionDate,
      );
      const missingProducts = Array.isArray(mismatchDetail.missingProducts)
        ? mismatchDetail.missingProducts
        : [];
      const lineItemMap = new Map(
        (bill.lineItems || []).map((lineItem) => [
          lineItem._id.toString(),
          lineItem,
        ]),
      );

      for (const item of missingProducts) {
        try {
          const billQty = Number(item.billQty || 0);
          if (billQty <= 0) {
            summary.skipped.push({
              billNo,
              productCode: item.product_code,
              reason: `Invalid billQty: ${item.billQty}`,
            });
            continue;
          }

          const productId = toObjectId(item.productId, "productId");
          const lineItemId = toObjectId(item.lineItemId, "lineItemId");
          const billLineItem = lineItemMap.get(lineItemId.toString());

          if (!billLineItem) {
            summary.skipped.push({
              billNo,
              productCode: item.product_code,
              reason: `Line item not found on bill: ${item.lineItemId}`,
            });
            continue;
          }

          const invId = billLineItem.inventoryId || item.inventoryId;
          if (!invId) {
            summary.skipped.push({
              billNo,
              productCode: item.product_code,
              reason: "Missing inventoryId",
            });
            continue;
          }

          const inventory = await Inventory.findById(invId).lean();
          if (!inventory) {
            summary.skipped.push({
              billNo,
              productCode: item.product_code,
              reason: `Inventory item not found: ${invId}`,
            });
            continue;
          }

          const existingTransaction = await existingDeliveryTransaction({
            distributorId,
            billId: finalBillId,
            lineItemId,
            billNo,
            productId,
          });

          if (existingTransaction) {
            if (
              needsBillLink(existingTransaction, finalBillId, lineItemId)
            ) {
              if (!WRITE_MODE) {
                console.log(
                  `[DRY-LINK] ${billNo} | ${item.product_code} | ${existingTransaction.transactionId}`,
                );
              } else {
                await linkExistingTransaction({
                  transaction: existingTransaction,
                  billId: finalBillId,
                  lineItemId,
                  transactionDate,
                  originalDeliveryDate,
                  enabledBackDate: Boolean(bill.enabledBackDate),
                });
                summary.linkedExisting++;
                console.log(
                  `[LINKED] ${billNo} | ${item.product_code} | ${existingTransaction.transactionId}`,
                );
              }
              continue;
            }

            summary.skipped.push({
              billNo,
              productCode: item.product_code,
              reason: `Transaction already exists: ${existingTransaction.transactionId}`,
            });
            continue;
          }

          summary.prepared++;
          const txnId = await transactionCode("LXSTA");
          const transactionData = {
            distributorId,
            productId,
            invItemId: invId,
            billId: finalBillId,
            billLineItemId: lineItemId,
            date: transactionDate,
            qty: billQty,
            transactionId: txnId,
            type: "Out",
            transactionType: "delivery",
            stockType: "salable",
            description: `Delivered against Bill ${billNo}`,
            balanceCount: Number(inventory.availableQty || 0),
            dates: {
              deliveryDate: transactionDate,
              originalDeliveryDate,
            },
            enabledBackDate: Boolean(bill.enabledBackDate),
          };

          if (transactionDate) {
            transactionData.createdAt = transactionDate;
            transactionData.updatedAt = transactionDate;
          }

          if (!WRITE_MODE) {
            console.log(
              `[DRY] ${billNo} | ${item.product_code} | qty ${billQty}`,
            );
            continue;
          }

          const transaction = await Transaction.create(transactionData);
          await Transaction.updateOne(
            { _id: transaction._id },
            {
              $set: {
                billId: finalBillId,
                billLineItemId: lineItemId,
              },
            },
          );
          summary.inserted++;
          console.log(
            `[INSERTED] ${billNo} | ${item.product_code} | ${transaction.transactionId}`,
          );

          if (!SKIP_STOCK_LEDGER) {
            try {
              await createStockLedgerEntry(transaction._id);
              summary.ledgerCreated++;
            } catch (ledgerError) {
              console.error(
                `Stock ledger creation failed for transaction ${transaction._id}:`,
                ledgerError.message,
              );
            }
          }
        } catch (error) {
          summary.errors.push({
            billNo,
            productCode: item.product_code,
            reason: error.message,
          });
        }
      }
    }

    console.log("\nSummary");
    console.log(`Bills    : ${summary.billsInReport}`);
    console.log(`Prepared : ${summary.prepared}`);
    console.log(`Inserted : ${summary.inserted}`);
    console.log(`Linked   : ${summary.linkedExisting}`);
    console.log(`Ledger   : ${summary.ledgerCreated}`);
    console.log(`Skipped  : ${summary.skipped.length}`);
    console.log(`Errors   : ${summary.errors.length}`);

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
