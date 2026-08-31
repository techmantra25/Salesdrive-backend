const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Transaction = require("../../models/transaction.model");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const { transactionCode } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const {
  createBulkStockLedgerEntries,
} = require("../../controllers/transction/createStockLedgerEntry");

// Which Inventory fields a given stockType bucket maps to, for the purpose
// of a godown-wise adjustment. Mirrors the map used in stockTransfer.js so
// both controllers stay in sync if the Inventory schema changes.
const STOCK_FIELD_MAP = {
  salable: {
    qtyField: "availableQty",
    dlpField: "totalStockamtDlp",
    rlpField: "totalStockamtRlp",
  },
  unsalable: {
    qtyField: "unsalableQty",
    dlpField: "totalUnsalableamtDlp",
    rlpField: "totalUnsalableStockamtRlp",
  },
  reserve: {
    qtyField: "reservedQty",
    dlpField: null,
    rlpField: null,
  },
  offer: {
    qtyField: "offerQty",
    dlpField: null,
    rlpField: null,
  },
};

const recalcTotalQty = (inv) =>
  (inv.availableQty || 0) +
  (inv.unsalableQty || 0) +
  (inv.offerQty || 0) +
  (inv.reservedQty || 0);

/**
 * Godown-wise bulk stock adjustment (Add / Reduce).
 *
 * Expected req.body:
 * {
 *   data: [
 *     {
 *       product_code: "3100000001",
 *       product_name: "...",              // optional, informational only
 *       adjustment: "Add" | "Reduce",
 *       stockType: "salable" | "unsalable" | "reserve" | "offer",
 *       godownId: "<ObjectId>",            // REQUIRED - which godown's stock to adjust
 *       qty: 10,
 *       remarks: "optional free text",
 *     },
 *     ...
 *   ]
 * }
 *
 * IMPORTANT DIFFERENCE from the earlier version of this controller:
 * Inventory is now looked up by (productId + distributorId + godownId)
 * instead of just (productId + distributorId). A distributor can hold the
 * same product across several godowns, so scoping by godownId ensures an
 * adjustment made against "Godown A" never touches "Godown B"'s stock.
 */
const bulkAdjustment = asyncHandler(async (req, res) => {
  try {
    const { data } = req.body;
    const distributorId = req.user.id;

    if (!data || !Array.isArray(data)) {
      return res
        .status(400)
        .json({ message: "Data is required and must be an array" });
    }

    const transactions = [];
    const skippedRows = [];
    const stockId = await transactionCode("LXSTA");

    let totalAdjustmentPoints = 0;
    const processedProducts = [];

    await Promise.all(
      data.map(async (row, index) => {
        const productCode = row.product_code?.trim();
        const qty = parseInt(row.qty, 10);
        const adjustmentType = row.adjustment?.trim().toLowerCase();
        const stockType = row.stockType?.trim().toLowerCase();
        const godownId = row.godownId;
        const remarks = row.remarks?.length > 0 ? row.remarks : "adjustment";

        if (!productCode) {
          row.reason = `Product code is required at row ${index + 1}`;
          skippedRows.push({ ...row });
          return;
        }

        if (!godownId) {
          row.reason = `Godown is required for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        if (isNaN(qty) || qty <= 0) {
          row.reason = `Invalid quantity for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        if (!["add", "reduce"].includes(adjustmentType)) {
          row.reason = `Invalid adjustment type for Product code: ${productCode}. Must be 'Add' or 'Reduce'`;
          skippedRows.push({ ...row });
          return;
        }

        const fieldMap = STOCK_FIELD_MAP[stockType];

        if (!fieldMap) {
          row.reason = `Unknown or unsupported stock type "${row.stockType}" for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        const product = await Product.findOne({ product_code: productCode });

        if (!product) {
          row.reason = `Product with code ${productCode} not found`;
          skippedRows.push({ ...row });
          return;
        }

        const priceResponse = await axios.get(
          `${SERVER_URL}/api/v1/price/internal/product-pricing/${product._id}?distributorId=${distributorId}`,
        );

        const priceEntry = priceResponse?.data?.data[0];

        if (!priceEntry) {
          row.reason = `No price entry found for Product ID ${productCode} at row ${
            index + 1
          }`;
          skippedRows.push({ ...row });
          return;
        }

        let rlpbyPcs = 0;
        let dlpbyPcs = 0;

        if (product?.uom === "box") {
          const piecesPerBox = product?.no_of_pieces_in_a_box || 1;
          rlpbyPcs = priceEntry?.rlp_price / piecesPerBox;
          dlpbyPcs = priceEntry?.dlp_price / piecesPerBox;
        } else {
          rlpbyPcs = priceEntry?.rlp_price || 0;
          dlpbyPcs = priceEntry?.dlp_price || 0;
        }

        if (isNaN(rlpbyPcs) || isNaN(dlpbyPcs)) {
          row.reason = `Invalid RLP or DLP price calculation for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        // Godown-wise lookup - the key fix versus the old controller, which
        // matched on productId + distributorId only and could silently
        // adjust the wrong godown's stock when a product existed in more
        // than one godown for the same distributor.
        const inventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
          godownId,
        });

        if (!inventory) {
          row.reason = `No existing inventory found for Product code ${productCode} in the selected godown`;
          skippedRows.push({ ...row });
          return;
        }

        const currentQty = inventory[fieldMap.qtyField] || 0;

        if (adjustmentType === "reduce" && currentQty < qty) {
          row.reason = `Insufficient ${stockType} stock for Product code: ${productCode}. Available: ${currentQty}, Requested: ${qty}`;
          skippedRows.push({ ...row });
          return;
        }

        // Points calculation (unchanged from the previous controller) -
        // driven purely by qty moved, independent of which godown it's in.
        const basePoint = Number(product.base_point) || 0;
        let productAdjustmentPoints = 0;

        if (basePoint > 0) {
          productAdjustmentPoints = basePoint * qty;
          totalAdjustmentPoints +=
            adjustmentType === "add"
              ? productAdjustmentPoints
              : -productAdjustmentPoints;

          processedProducts.push({
            productCode,
            adjustmentType,
            qty,
            basePoint,
            points: productAdjustmentPoints,
          });
        }

        const sign = adjustmentType === "add" ? 1 : -1;

        inventory[fieldMap.qtyField] = Math.max(currentQty + sign * qty, 0);

        if (fieldMap.dlpField && fieldMap.rlpField) {
          inventory[fieldMap.dlpField] = Math.max(
            (inventory[fieldMap.dlpField] || 0) + sign * dlpbyPcs * qty,
            0,
          );
          inventory[fieldMap.rlpField] = Math.max(
            (inventory[fieldMap.rlpField] || 0) + sign * rlpbyPcs * qty,
            0,
          );
        }

        inventory.totalQty = recalcTotalQty(inventory);

        if (
          isNaN(inventory[fieldMap.qtyField]) ||
          isNaN(inventory.totalQty) ||
          (fieldMap.dlpField && isNaN(inventory[fieldMap.dlpField])) ||
          (fieldMap.rlpField && isNaN(inventory[fieldMap.rlpField]))
        ) {
          row.reason = `Invalid inventory calculations for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        await inventory.save();

        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: inventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: adjustmentType === "add" ? "In" : "Out",
          description: remarks,
          balanceCount: inventory[fieldMap.qtyField],
          transactionType: "stockadjustment",
          stockType,
          godownId,
        });
      }),
    );

    if (transactions.length > 0) {
      const createdTransactions = await Transaction.insertMany(transactions);

      try {
        await createBulkStockLedgerEntries(createdTransactions);
      } catch (error) {
        console.error("Bulk stock ledger creation failed:", error.message);
        // Don't throw - allow the adjustment response to still succeed
      }
    }

    if (processedProducts.length > 0 && totalAdjustmentPoints !== 0) {
      try {
        const distributor = await Distributor.findById(distributorId).lean();

        if (!distributor) {
          console.log(`Distributor not found for ID: ${distributorId}`);
        } else if (distributor?.RBPSchemeMapped !== "yes") {
          console.log(
            `Skipping adjustment points calculation - RBP scheme not mapped for distributor ${distributor.dbCode}`,
          );
        } else {
          const latestTransaction = await DistributorTransaction.findOne({
            distributorId,
          }).sort({ createdAt: -1 });

          const currentBalance = latestTransaction
            ? Number(latestTransaction.balance)
            : 0;

          const transactionType =
            totalAdjustmentPoints > 0 ? "credit" : "debit";
          const pointsToRecord = Math.abs(totalAdjustmentPoints);
          const newBalance =
            transactionType === "credit"
              ? currentBalance + pointsToRecord
              : Math.max(currentBalance - pointsToRecord, 0);

          const distributorTransaction = new DistributorTransaction({
            distributorId,
            transactionType,
            transactionFor: "Adjustment Point",
            point: Math.round(pointsToRecord),
            balance: newBalance,
            status: "Success",
            remark: `Stock adjustment points for ${processedProducts.length} products for DB Code ${distributor.dbCode} via adjustment`,
          });

          await distributorTransaction.save();
        }
      } catch (pointsError) {
        console.error("Error creating distributor transaction:", pointsError);
        // Don't fail the entire operation, just log the error
      }
    }

    res.status(201).json({
      message: "Stock adjustment processed successfully",
      transactions,
      skippedRows,
      adjustmentSummary: {
        totalProcessedProducts: processedProducts.length,
        totalAdjustmentPoints: Math.round(totalAdjustmentPoints),
        processedProducts,
      },
    });
  } catch (error) {
    console.error("Error in bulk stock adjustment:", error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = {
  bulkAdjustment,
};