// ============================================================================
// OLD LOGIC #1 (original, stock-type <-> stock-type within the SAME godown,
// salable/unsalable/offer only) — kept commented for history, matches the
// very first version of this controller.
// ============================================================================
// ...(unchanged, see previous version of this file)...

// ============================================================================
// OLD LOGIC #2 (stock-type <-> stock-type within the SAME godown, extended
// to include "reserve") — this was the ACTIVE version before this change.
// It is being REPLACED because the frontend (StockTransfer.jsx) no longer
// sends stockTypeFrom/stockTypeTo — it now sends godownIdFrom/godownIdTo +
// a single stockType per row, since the page transfers stock between two
// GODOWNS rather than reclassifying stock type within one godown.
//
// If stock-type-to-stock-type transfers (e.g. Salable -> Unsalable within
// the same godown) are still needed elsewhere, keep that old handler alive
// under a different route/export name rather than deleting it outright.
// ============================================================================
// const stockTransfer = asyncHandler(async (req, res) => {
//   ...(unchanged, see previous version of this file)...
// });

const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Transaction = require("../../models/transaction.model");
const { transactionCode } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const {
  createBulkStockLedgerEntries,
} = require("../../controllers/transction/createStockLedgerEntry");

// Which Inventory fields a given stockType bucket maps to, for the purpose
// of a godown-to-godown transfer. "pending" is intentionally NOT included
// here — pendingOrderQty is never stored on the Inventory document at all;
// it's computed on the fly in inventoryPaginatedList by aggregating
// un-billed orderEntry line items for the product. There is no physical
// stock sitting against a product+godown to move for "pending", so any row
// with stockType "pending" is always skipped with an explanatory reason.
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
  offer: {
    qtyField: "offerQty",
    dlpField: null,
    rlpField: null,
  },
  reserve: {
    qtyField: "reservedQty",
    dlpField: null,
    rlpField: null,
  },
  intransit: {
    qtyField: "intransitQty",
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
 * Transfers stock for a set of products from one godown to another.
 *
 * Expected req.body:
 * {
 *   data: [
 *     {
 *       product_code: "3100000001",
 *       product_name: "CPVC-P-15-MM-SDR11-3M-3092", // optional, informational only
 *       stockType: "salable" | "unsalable" | "offer" | "reserve" | "intransit",
 *       godownIdFrom: "<ObjectId>",
 *       godownIdTo: "<ObjectId>",
 *       qty: 10,
 *       remarks: "optional free text",
 *     },
 *     ...
 *   ]
 * }
 *
 * A single product can appear multiple times in `data` (once per stockType
 * bucket) if the caller wants to move e.g. both Salable and Reserve qty for
 * the same product in one submission — the frontend's Stock Transfer screen
 * does exactly this when more than one "Transfer Qty" box is filled in for
 * a row.
 */
const stockTransfer = asyncHandler(async (req, res) => {
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

    await Promise.all(
      data.map(async (row, index) => {
        const productCode = row.product_code?.trim();
        const qty = parseInt(row.qty, 10) || 0;
        const stockType = row.stockType?.trim().toLowerCase();
        const godownIdFrom = row.godownIdFrom;
        const godownIdTo = row.godownIdTo;
        const remarks = row.remarks
          ? row.remarks.trim()
          : `Godown stock Transfer (${stockType})`;

        if (!productCode) {
          row.reason = `Product code is required at row ${index + 1}`;
          skippedRows.push({ ...row });
          return;
        }

        if (isNaN(qty) || qty <= 0) {
          row.reason = `Invalid quantity for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        if (!godownIdFrom || !godownIdTo) {
          row.reason = `From Godown and To Godown are both required for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        if (String(godownIdFrom) === String(godownIdTo)) {
          row.reason = `From Godown and To Godown cannot be the same for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        const fieldMap = STOCK_FIELD_MAP[stockType];

        if (!fieldMap) {
          row.reason =
            stockType === "pending"
              ? `Pending Order Qty cannot be transferred — it isn't physical stock held against a godown, for Product code: ${productCode}`
              : `Unknown stock type "${row.stockType}" for Product code: ${productCode}`;
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
          row.reason = `No price entry found for Product ID ${productCode} at row ${index + 1
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

        const sourceInventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
          godownId: godownIdFrom,
        });

        if (!sourceInventory) {
          row.reason = `No inventory found for Product code ${productCode} in the source godown`;
          skippedRows.push({ ...row });
          return;
        }

        const availableInSource = sourceInventory[fieldMap.qtyField] || 0;

        if (qty > availableInSource) {
          row.reason = `Insufficient ${stockType} stock in source godown for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        let destinationInventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
          godownId: godownIdTo,
        });

        // Destination godown may not have an inventory row for this product
        // yet (first time stock ever lands there) — create one.
        if (!destinationInventory) {
          destinationInventory = new Inventory({
            productId: product._id,
            distributorId,
            godownId: godownIdTo,
            godownType: row.godownTypeTo || sourceInventory.godownType,
            invitemId: sourceInventory.invitemId,
          });
        }

        // Move qty out of source, into destination.
        sourceInventory[fieldMap.qtyField] = Math.max(
          availableInSource - qty,
          0,
        );
        destinationInventory[fieldMap.qtyField] =
          (destinationInventory[fieldMap.qtyField] || 0) + qty;

        // Carry the DLP/RLP valuation along with the qty, for buckets that
        // track it (salable / unsalable). Offer, reserve and in-transit
        // don't carry a separate amount field in the schema, same as in
        // the previous stock-type-transfer logic.
        if (fieldMap.dlpField && fieldMap.rlpField) {
          sourceInventory[fieldMap.dlpField] = Math.max(
            (sourceInventory[fieldMap.dlpField] || 0) - dlpbyPcs * qty,
            0,
          );
          sourceInventory[fieldMap.rlpField] = Math.max(
            (sourceInventory[fieldMap.rlpField] || 0) - rlpbyPcs * qty,
            0,
          );

          destinationInventory[fieldMap.dlpField] =
            (destinationInventory[fieldMap.dlpField] || 0) + dlpbyPcs * qty;
          destinationInventory[fieldMap.rlpField] =
            (destinationInventory[fieldMap.rlpField] || 0) + rlpbyPcs * qty;
        }

        sourceInventory.totalQty = recalcTotalQty(sourceInventory);
        destinationInventory.totalQty = recalcTotalQty(destinationInventory);

        if (
          isNaN(sourceInventory[fieldMap.qtyField]) ||
          isNaN(destinationInventory[fieldMap.qtyField]) ||
          isNaN(sourceInventory.totalQty) ||
          isNaN(destinationInventory.totalQty)
        ) {
          row.reason = `Invalid inventory calculations for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        await sourceInventory.save();
        await destinationInventory.save();

        // "Out" transaction against the source godown's inventory row
        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: sourceInventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: "Out",
          description: remarks,
          balanceCount: sourceInventory[fieldMap.qtyField],
          transactionType: "godowntransfer",
          stockType,
          godownId: godownIdFrom,
        });

        // "In" transaction against the destination godown's inventory row
        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: destinationInventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: "In",
          description: remarks,
          balanceCount: destinationInventory[fieldMap.qtyField],
          transactionType: "godowntransfer",
          stockType,
          godownId: godownIdTo,
        });
      }),
    );

    if (transactions.length > 0) {
      const createdTransactions = await Transaction.insertMany(transactions);

      // Create stock ledger entries in bulk
      try {
        await createBulkStockLedgerEntries(createdTransactions);
      } catch (error) {
        console.error("Bulk stock ledger creation failed:", error.message);
        // Don't throw - allow the transfer response to still succeed
      }
    }

    res.json({
      status: "success",
      message: "Stock transfer completed",
      skippedRows,
    });
  } catch (error) {
    console.error("Stock Transfer Error:", error);
    res.status(500).json({ message: "Stock Transfer failed", error });
  }
});

module.exports = { stockTransfer };