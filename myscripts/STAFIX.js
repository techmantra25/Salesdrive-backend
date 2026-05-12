const mongoose = require("mongoose");
const moment = require("moment-timezone");
const Transaction = require("../models/transaction.model");
const Inventory = require("../models/inventory.model");
const SalesReturn = require("../models/salesReturn.model");
const { transactionCode } = require("../utils/codeGenerator");
const {
  createStockLedgerEntry,
} = require("../controllers/transction/createStockLedgerEntry");

const MONGO_URI =
  "mongodb://rupaAdmin:admin2025@127.0.0.1:27017/rupadms?authSource=rupadms";

const data = require("./salesReturns.json");

const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
const SKIP_STOCK_LEDGER = args.includes("--no-ledger");

function toObjectId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new mongoose.Types.ObjectId(value);
}

function getTransactionDate(createdAt) {
  return moment
    .tz(createdAt, "Asia/Kolkata")
    .set({ hour: 5, minute: 30, second: 0, millisecond: 0 })
    .toDate();
}

async function existingSalesReturnTransaction({
  distributorId,
  billId,
  lineItemId,
  salesReturnNo,
  productId,
}) {
  return Transaction.findOne({
    distributorId,
    transactionType: "salesreturn",
    type: "In",
    productId,
    $or: [
      { billId, billLineItemId: lineItemId },
      {
        description: new RegExp(`Sales Return (for )?${salesReturnNo}\\b`, "i"),
      },
    ],
  }).lean();
}

async function run() {
  const summary = {
    prepared: 0,
    inserted: 0,
    ledgerCreated: 0,
    skipped: [],
    errors: [],
  };

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");
    console.log(
      `Mode: ${WRITE_MODE ? "WRITE" : "DRY RUN"}${
        WRITE_MODE && !SKIP_STOCK_LEDGER ? " + STOCK LEDGER" : ""
      }`,
    );

    if (!Array.isArray(data.mismatchDetails)) {
      throw new Error("salesReturns.json must contain mismatchDetails array");
    }

    for (const sr of data.mismatchDetails) {
      const salesReturnId = toObjectId(sr.salesReturnId, "salesReturnId");
      const srDoc = await SalesReturn.findById(salesReturnId)
        .select(
          "distributorId goodsType billId lineItems salesReturnDate originalSalesReturnDate enabledBackDate createdAt",
        )
        .lean();

      if (!srDoc) {
        summary.skipped.push({
          salesReturnNo: sr.salesReturnNo,
          reason: `Sales return not found: ${sr.salesReturnId}`,
        });
        continue;
      }

      const distributorId = srDoc.distributorId;
      const stockType =
        srDoc.goodsType === "Unsalable" ? "unsalable" : "salable";
      const transactionDate =
        srDoc.salesReturnDate ||
        srDoc.createdAt ||
        getTransactionDate(sr.createdAt);
      const originalTransactionDate =
        srDoc.originalSalesReturnDate || srDoc.createdAt || transactionDate;
      const missingProducts = Array.isArray(sr.missingProducts)
        ? sr.missingProducts
        : [];
      const lineItemMap = new Map(
        (srDoc.lineItems || []).map((lineItem) => [
          lineItem._id.toString(),
          lineItem,
        ]),
      );

      for (const item of missingProducts) {
        try {
          const returnQty = Number(item.returnQty || 0);
          if (returnQty <= 0) {
            summary.skipped.push({
              salesReturnNo: sr.salesReturnNo,
              productCode: item.product_code,
              reason: `Invalid returnQty: ${item.returnQty}`,
            });
            continue;
          }

          const productId = toObjectId(item.productId, "productId");
          const lineItemId = toObjectId(item.lineItemId, "lineItemId");

          const existingTransaction = await existingSalesReturnTransaction({
            distributorId,
            billId: srDoc.billId,
            lineItemId,
            salesReturnNo: sr.salesReturnNo,
            productId,
          });

          if (existingTransaction) {
            summary.skipped.push({
              salesReturnNo: sr.salesReturnNo,
              productCode: item.product_code,
              reason: `Transaction already exists: ${existingTransaction.transactionId}`,
            });
            continue;
          }

          const srLineItem = lineItemMap.get(lineItemId.toString());
          if (!srLineItem) {
            summary.skipped.push({
              salesReturnNo: sr.salesReturnNo,
              productCode: item.product_code,
              reason: `Line item not found on sales return: ${item.lineItemId}`,
            });
            continue;
          }

          const inventoryDoc = await Inventory.findById(srLineItem.inventoryId);

          if (!inventoryDoc) {
            summary.skipped.push({
              salesReturnNo: sr.salesReturnNo,
              productCode: item.product_code,
              reason: `Inventory item not found: ${srLineItem.inventoryId}`,
            });
            continue;
          }

          summary.prepared++;
          const stockId = await transactionCode("LXSTA");

          const transactionData = {
            distributorId,
            transactionId: stockId,
            invItemId: srLineItem.inventoryId,
            productId: inventoryDoc.productId,
            billId: srDoc.billId,
            billLineItemId: srLineItem._id,
            qty: returnQty,
            date: transactionDate,
            type: "In",
            description: `Sales Return for ${sr.salesReturnNo}`,
            balanceCount:
              stockType === "salable"
                ? inventoryDoc.availableQty
                : inventoryDoc.unsalableQty,
            transactionType: "salesreturn",
            stockType,
            dates: {
              deliveryDate: transactionDate,
              originalDeliveryDate: originalTransactionDate,
            },
            enabledBackDate: Boolean(srDoc.enabledBackDate),
          };

          if (transactionDate) {
            transactionData.createdAt = transactionDate;
            transactionData.updatedAt = transactionDate;
          }

          if (!WRITE_MODE) {
            console.log(
              `[DRY] ${sr.salesReturnNo} | ${item.product_code} | qty ${returnQty}`,
            );
            continue;
          }

          const transaction = await Transaction.create(transactionData);
          summary.inserted++;
          console.log(
            `[INSERTED] ${sr.salesReturnNo} | ${item.product_code} | ${transaction.transactionId}`,
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
            salesReturnNo: sr.salesReturnNo,
            productCode: item.product_code,
            reason: error.message,
          });
        }
      }
    }

    console.log("\nSummary");
    console.log(`Prepared : ${summary.prepared}`);
    console.log(`Inserted : ${summary.inserted}`);
    console.log(`Ledger   : ${summary.ledgerCreated}`);
    console.log(`Skipped  : ${summary.skipped.length}`);
    console.log(`Errors   : ${summary.errors.length}`);

    if (summary.skipped.length) {
      console.log("\nSkipped items");
      summary.skipped.forEach((item) => {
        console.log(
          `- ${item.salesReturnNo} | ${item.productCode || "-"} | ${item.reason}`,
        );
      });
    }

    if (summary.errors.length) {
      console.log("\nErrors");
      summary.errors.forEach((item) => {
        console.log(
          `- ${item.salesReturnNo} | ${item.productCode || "-"} | ${item.reason}`,
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
