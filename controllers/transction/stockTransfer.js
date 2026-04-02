// const asyncHandler = require("express-async-handler");
// const Inventory = require("../../models/inventory.model");
// const Product = require("../../models/product.model");
// const Transaction = require("../../models/transaction.model");
// const { transactionCode } = require("../../utils/codeGenerator");
// const { SERVER_URL } = require("../../config/server.config");
// const axios = require("axios");

// const stockTransfer = asyncHandler(async (req, res) => {
//   try {
//     const { data } = req.body;
//     const distributorId = req.user.id;

//     if (!data || !Array.isArray(data)) {
//       return res
//         .status(400)
//         .json({ message: "Data is required and must be an array" });
//     }

//     const transactions = [];
//     const skippedRows = [];
//     const stockId = await transactionCode("LXSTA");

//     await Promise.all(
//       data.map(async (row, index) => {
//         console.log(`Processing row ${index + 1}:`, row);

//         const productCode = row.product_code.trim();
//         const qty = parseInt(row.qty, 10) || 0; // Default to 0 if qty is not provided
//         const stockTypeFrom = row.stockTypeFrom.trim().toLowerCase();
//         const stockTypeTo = row.stockTypeTo.trim().toLowerCase();
//         const remarks = row.remarks
//           ? row.remarks.trim()
//           : `${stockTypeFrom} to ${stockTypeTo} Transfer`;

//         if (isNaN(qty) || qty <= 0) {
//           row.reason = `Invalid quantity for Product code: ${productCode}`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         const product = await Product.findOne({ product_code: productCode });

//         if (!product) {
//           row.reason = `Product with code ${productCode} not found`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         const priceResponse = await axios.get(
//           `${SERVER_URL}/api/v1/price/product-pricing/${product._id}?distributorId=${distributorId}`
//         );

//         const priceEntry = priceResponse?.data?.data[0];

//         if (!priceEntry) {
//           row.reason = `No price entry found for Product ID ${productCode} at row ${
//             index + 1
//           }`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         let rlpbyPcs = 0;
//         let dlpbyPcs = 0;

//         if (product?.uom === "box") {
//           const piecesPerBox = product?.no_of_pieces_in_a_box || 1;
//           rlpbyPcs = priceEntry?.rlp_price / piecesPerBox;
//           dlpbyPcs = priceEntry?.dlp_price / piecesPerBox;
//         } else {
//           rlpbyPcs = priceEntry?.rlp_price || 0;
//           dlpbyPcs = priceEntry?.dlp_price || 0;
//         }

//         if (isNaN(rlpbyPcs) || isNaN(dlpbyPcs)) {
//           row.reason = `Invalid RLP or DLP price calculation for Product code: ${productCode}`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         let inventory = await Inventory.findOne({
//           productId: product._id,
//           distributorId,
//         });

//         if (!inventory) {
//           row.reason = `No existing inventory found for Product ID ${productCode} and Distributor ID ${distributorId}`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         // Check if the quantity is greater than the available stock in the relevant stock type
//         if (
//           (stockTypeFrom === "salable" && qty > inventory.availableQty) ||
//           (stockTypeFrom === "unsalable" && qty > inventory.unsalableQty) ||
//           (stockTypeFrom === "offer" && qty > inventory.offerQty)
//         ) {
//           row.reason = `Insufficient stock in ${stockTypeFrom} for Product code: ${productCode}`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         // Adjust inventory quantities based on stockTypeFrom and stockTypeTo
//         const transferStock = () => {
//           if (stockTypeFrom === "salable" && stockTypeTo === "unsalable") {
//             inventory.availableQty = Math.max(
//               (inventory.availableQty || 0) - qty,
//               0
//             );
//             inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
//             inventory.totalStockamtDlp = Math.max(
//               (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
//               0
//             );
//             inventory.totalStockamtRlp = Math.max(
//               (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
//               0
//             );
//             inventory.totalUnsalableamtDlp =
//               (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
//             inventory.totalUnsalableStockamtRlp =
//               (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
//           } else if (
//             stockTypeFrom === "unsalable" &&
//             stockTypeTo === "salable"
//           ) {
//             inventory.unsalableQty = Math.max(
//               (inventory.unsalableQty || 0) - qty,
//               0
//             );
//             inventory.availableQty = (inventory.availableQty || 0) + qty;
//             inventory.totalUnsalableamtDlp = Math.max(
//               (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
//               0
//             );
//             inventory.totalUnsalableStockamtRlp = Math.max(
//               (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
//               0
//             );
//             inventory.totalStockamtDlp =
//               (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
//             inventory.totalStockamtRlp =
//               (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
//           } else if (stockTypeFrom === "salable" && stockTypeTo === "offer") {
//             inventory.availableQty = Math.max(
//               (inventory.availableQty || 0) - qty,
//               0
//             );
//             inventory.offerQty = (inventory.offerQty || 0) + qty;
//             inventory.totalStockamtDlp = Math.max(
//               (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
//               0
//             );
//             inventory.totalStockamtRlp = Math.max(
//               (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
//               0
//             );
//           } else if (stockTypeFrom === "offer" && stockTypeTo === "salable") {
//             inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
//             inventory.availableQty = (inventory.availableQty || 0) + qty;
//             inventory.totalStockamtDlp =
//               (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
//             inventory.totalStockamtRlp =
//               (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
//           } else if (stockTypeFrom === "offer" && stockTypeTo === "unsalable") {
//             inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
//             inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
//             inventory.totalUnsalableamtDlp =
//               (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
//             inventory.totalUnsalableStockamtRlp =
//               (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
//           } else if (stockTypeFrom === "unsalable" && stockTypeTo === "offer") {
//             inventory.unsalableQty = Math.max(
//               (inventory.unsalableQty || 0) - qty,
//               0
//             );
//             inventory.offerQty = (inventory.offerQty || 0) + qty;
//             inventory.totalUnsalableamtDlp = Math.max(
//               (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
//               0
//             );
//             inventory.totalUnsalableStockamtRlp = Math.max(
//               (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
//               0
//             );
//           }
//         };

//         transferStock();

//         // Update totalQty based on stock adjustments
//         inventory.totalQty =
//           (inventory.availableQty || 0) +
//           (inventory.unsalableQty || 0) +
//           (inventory.offerQty || 0);

//         if (
//           isNaN(inventory.availableQty) ||
//           isNaN(inventory.totalStockamtDlp) ||
//           isNaN(inventory.totalStockamtRlp) ||
//           isNaN(inventory.unsalableQty) ||
//           isNaN(inventory.totalUnsalableamtDlp) ||
//           isNaN(inventory.totalUnsalableStockamtRlp) ||
//           isNaN(inventory.offerQty) ||
//           isNaN(inventory.totalQty)
//         ) {
//           row.reason = `Invalid inventory calculations for Product code: ${productCode}`;
//           skippedRows.push({ ...row });
//           return;
//         }

//         await inventory.save();

//         transactions.push({
//           distributorId,
//           transactionId: stockId,
//           invItemId: inventory._id,
//           productId: product._id,
//           qty,
//           date: new Date(),
//           type: "In",
//           description: remarks,
//           balanceCount:
//             stockTypeTo === "salable"
//               ? inventory.availableQty
//               : stockTypeTo === "unsalable"
//               ? inventory.unsalableQty
//               : inventory.offerQty,
//           transactionType: "stocktransfer",
//           stockType: stockTypeTo,
//         });
//       })
//     );

//     if (transactions.length > 0) {
//       await Transaction.insertMany(transactions);
//     }

//     res.json({
//       status: "success",
//       message: "Stock transfer completed",
//       skippedRows,
//     });
//   } catch (error) {
//     console.error("Stock Transfer Error:", error);
//     res.status(500).json({ message: "Stock Transfer failed", error });
//   }
// });

// module.exports = { stockTransfer };

// new logic

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
        const productCode = row.product_code.trim();
        const qty = parseInt(row.qty, 10) || 0; // Default to 0 if qty is not provided
        const stockTypeFrom = row.stockTypeFrom.trim().toLowerCase();
        const stockTypeTo = row.stockTypeTo.trim().toLowerCase();
        const remarks = row.remarks
          ? row.remarks.trim()
          : `${stockTypeFrom} to ${stockTypeTo} Transfer`;

        if (isNaN(qty) || qty <= 0) {
          row.reason = `Invalid quantity for Product code: ${productCode}`;
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

        let inventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
        });

        if (!inventory) {
          row.reason = `No existing inventory found for Product ID ${productCode} and Distributor ID ${distributorId}`;
          skippedRows.push({ ...row });
          return;
        }

        // Check if the quantity is greater than the available stock in the relevant stock type
        if (
          (stockTypeFrom === "salable" && qty > inventory.availableQty) ||
          (stockTypeFrom === "unsalable" && qty > inventory.unsalableQty) ||
          (stockTypeFrom === "offer" && qty > inventory.offerQty) ||
          (stockTypeFrom === "reserve" && qty > inventory.reservedQty)
        ) {
          row.reason = `Insufficient stock in ${stockTypeFrom} for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        // Adjust inventory quantities based on stockTypeFrom and stockTypeTo
        const transferStock = () => {
          if (stockTypeFrom === "salable" && stockTypeTo === "unsalable") {
            inventory.availableQty = Math.max(
              (inventory.availableQty || 0) - qty,
              0,
            );
            inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
            inventory.totalStockamtDlp = Math.max(
              (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalStockamtRlp = Math.max(
              (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
            inventory.totalUnsalableamtDlp =
              (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalUnsalableStockamtRlp =
              (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (
            stockTypeFrom === "unsalable" &&
            stockTypeTo === "salable"
          ) {
            inventory.unsalableQty = Math.max(
              (inventory.unsalableQty || 0) - qty,
              0,
            );
            inventory.availableQty = (inventory.availableQty || 0) + qty;
            inventory.totalUnsalableamtDlp = Math.max(
              (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalUnsalableStockamtRlp = Math.max(
              (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
            inventory.totalStockamtDlp =
              (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalStockamtRlp =
              (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (stockTypeFrom === "salable" && stockTypeTo === "offer") {
            inventory.availableQty = Math.max(
              (inventory.availableQty || 0) - qty,
              0,
            );
            inventory.offerQty = (inventory.offerQty || 0) + qty;
            inventory.totalStockamtDlp = Math.max(
              (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalStockamtRlp = Math.max(
              (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          } else if (stockTypeFrom === "offer" && stockTypeTo === "salable") {
            inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
            inventory.availableQty = (inventory.availableQty || 0) + qty;
            inventory.totalStockamtDlp =
              (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalStockamtRlp =
              (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (stockTypeFrom === "offer" && stockTypeTo === "unsalable") {
            inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
            inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
            inventory.totalUnsalableamtDlp =
              (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalUnsalableStockamtRlp =
              (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (stockTypeFrom === "unsalable" && stockTypeTo === "offer") {
            inventory.unsalableQty = Math.max(
              (inventory.unsalableQty || 0) - qty,
              0,
            );
            inventory.offerQty = (inventory.offerQty || 0) + qty;
            inventory.totalUnsalableamtDlp = Math.max(
              (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalUnsalableStockamtRlp = Math.max(
              (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          } else if (stockTypeFrom === "salable" && stockTypeTo === "reserve") {
            inventory.availableQty = Math.max(
              (inventory.availableQty || 0) - qty,
              0,
            );
            inventory.reservedQty = (inventory.reservedQty || 0) + qty;
            inventory.totalStockamtDlp = Math.max(
              (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalStockamtRlp = Math.max(
              (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          }
          // NEW: Reserve to Salable
          else if (stockTypeFrom === "reserve" && stockTypeTo === "salable") {
            inventory.reservedQty = Math.max(
              (inventory.reservedQty || 0) - qty,
              0,
            );
            inventory.availableQty = (inventory.availableQty || 0) + qty;
            inventory.totalStockamtDlp =
              (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalStockamtRlp =
              (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
          }
          // NEW: Reserve to Unsalable
          else if (stockTypeFrom === "reserve" && stockTypeTo === "unsalable") {
            inventory.reservedQty = Math.max(
              (inventory.reservedQty || 0) - qty,
              0,
            );
            inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
            inventory.totalUnsalableamtDlp =
              (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalUnsalableStockamtRlp =
              (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
          }
          // NEW: Unsalable to Reserve
          else if (stockTypeFrom === "unsalable" && stockTypeTo === "reserve") {
            inventory.unsalableQty = Math.max(
              (inventory.unsalableQty || 0) - qty,
              0,
            );
            inventory.reservedQty = (inventory.reservedQty || 0) + qty;
            inventory.totalUnsalableamtDlp = Math.max(
              (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalUnsalableStockamtRlp = Math.max(
              (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          }
          // NEW: Reserve to Offer
          else if (stockTypeFrom === "reserve" && stockTypeTo === "offer") {
            inventory.reservedQty = Math.max(
              (inventory.reservedQty || 0) - qty,
              0,
            );
            inventory.offerQty = (inventory.offerQty || 0) + qty;
          }
          // NEW: Offer to Reserve
          else if (stockTypeFrom === "offer" && stockTypeTo === "reserve") {
            inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
            inventory.reservedQty = (inventory.reservedQty || 0) + qty;
          }
        };

        transferStock();

        // Update totalQty based on stock adjustments
        inventory.totalQty =
          (inventory.availableQty || 0) +
          (inventory.unsalableQty || 0) +
          (inventory.offerQty || 0) +
          (inventory.reservedQty || 0);

        if (
          isNaN(inventory.availableQty) ||
          isNaN(inventory.totalStockamtDlp) ||
          isNaN(inventory.totalStockamtRlp) ||
          isNaN(inventory.unsalableQty) ||
          isNaN(inventory.totalUnsalableamtDlp) ||
          isNaN(inventory.totalUnsalableStockamtRlp) ||
          isNaN(inventory.offerQty) ||
          isNaN(inventory.reservedQty) ||
          isNaN(inventory.totalQty)
        ) {
          row.reason = `Invalid inventory calculations for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        await inventory.save();

        // Add the "Out" transaction for stockTypeFrom
        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: inventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: "Out",
          description: remarks,
          balanceCount:
            stockTypeFrom === "salable"
              ? inventory.availableQty
              : stockTypeFrom === "unsalable"
                ? inventory.unsalableQty
                : stockTypeFrom === "offer"
                  ? inventory.offerQty
                  : inventory.reservedQty,
          transactionType: "stocktransfer",
          stockType: stockTypeFrom,
        });

        // Add the "In" transaction for stockTypeTo
        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: inventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: "In",
          description: remarks,
          balanceCount:
            stockTypeTo === "salable"
              ? inventory.availableQty
              : stockTypeTo === "unsalable"
                ? inventory.unsalableQty
                : stockTypeTo === "offer"
                  ? inventory.offerQty
                  : inventory.reservedQty,
          transactionType: "stocktransfer",
          stockType: stockTypeTo,
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
        // Don't throw - allow adjustment to continue
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
