const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Transaction = require("../../models/transaction.model");
const Distributor = require("../../models/distributor.model"); // **NEW: Added distributor import**
const DistributorTransaction = require("../../models/distributorTransaction.model"); // **NEW: Added DistributorTransaction import**
const { transactionCode } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const {
  createBulkStockLedgerEntries,
} = require("../../controllers/transction/createStockLedgerEntry");

const bulkAdjustment = asyncHandler(async (req, res) => {
  try {
    const { data } = req.body;
    const distributorId = req.user.id;

    // console.log("i was called")

    // console.log(distributorId, "distributorId in bulk adjustment");

    if (!data || !Array.isArray(data)) {
      return res
        .status(400)
        .json({ message: "Test data is required and must be an array" });
    }

    const transactions = [];
    const skippedRows = [];
    const stockId = await transactionCode("LXSTA");

    // **NEW: Initialize points tracking variables**
    let totalAdjustmentPoints = 0;
    const processedProducts = []; // Track processed products for logging

    await Promise.all(
      data.map(async (row, index) => {
        const productCode = row.product_code.trim();
        const qty = parseInt(row.qty, 10);
        const adjustmentType = row.adjustment.trim().toLowerCase();
        const stockType = row.stockType.trim().toLowerCase();

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

        let initialTotalQty = inventory.totalQty || 0;

        // **NEW: Calculate adjustment points before inventory update**
        const basePoint = Number(product.base_point) || 0;
        if (basePoint > 0) {
          let productAdjustmentPoints = 0;

          if (adjustmentType === "add") {
            // For add adjustment, credit points
            productAdjustmentPoints = basePoint * qty;
            totalAdjustmentPoints += productAdjustmentPoints;
          } else if (adjustmentType === "reduce") {
            // For reduce adjustment, debit points
            productAdjustmentPoints = basePoint * qty;
            totalAdjustmentPoints -= productAdjustmentPoints;
          }

          processedProducts.push({
            productCode,
            adjustmentType,
            qty,
            basePoint,
            points: productAdjustmentPoints,
          });
        }

        if (adjustmentType === "reduce") {
          let currentStock;

          if (stockType === "salable") {
            currentStock = inventory.availableQty || 0;
          } else if (stockType === "unsalable") {
            currentStock = inventory.unsalableQty || 0;
          } else if (stockType === "reserve") {
            currentStock = inventory.reservedQty || 0;
          }
          // else if (stockType === "offer") {
          //   currentStock = inventory.offerQty || 0;
          // }

          if (currentStock < qty) {
            row.reason = `Insufficient ${stockType} stock for Product code: ${productCode}. Available: ${currentStock}, Requested: ${qty}`;
            skippedRows.push({ ...row });
            return;
          }
        }

        if (adjustmentType === "add") {
          if (stockType === "salable") {
            inventory.availableQty = (inventory.availableQty || 0) + qty;
            inventory.totalStockamtDlp =
              (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalStockamtRlp =
              (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (stockType === "unsalable") {
            inventory.unsalableQty = (inventory.unsalableQty || 0) + qty;
            inventory.totalUnsalableamtDlp =
              (inventory.totalUnsalableamtDlp || 0) + dlpbyPcs * qty;
            inventory.totalUnsalableStockamtRlp =
              (inventory.totalUnsalableStockamtRlp || 0) + rlpbyPcs * qty;
          } else if (stockType === "reserve") {
            inventory.reservedQty = (inventory.reservedQty || 0) + qty;
          }
          // else if (stockType === "offer") {
          //   inventory.offerQty = (inventory.offerQty || 0) + qty;
          // }
        } else if (adjustmentType === "reduce") {
          if (stockType === "salable") {
            inventory.availableQty = Math.max(
              (inventory.availableQty || 0) - qty,
              0,
            );
            inventory.totalStockamtDlp = Math.max(
              (inventory.totalStockamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalStockamtRlp = Math.max(
              (inventory.totalStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          } else if (stockType === "unsalable") {
            inventory.unsalableQty = Math.max(
              (inventory.unsalableQty || 0) - qty,
              0,
            );
            inventory.totalUnsalableamtDlp = Math.max(
              (inventory.totalUnsalableamtDlp || 0) - dlpbyPcs * qty,
              0,
            );
            inventory.totalUnsalableStockamtRlp = Math.max(
              (inventory.totalUnsalableStockamtRlp || 0) - rlpbyPcs * qty,
              0,
            );
          } else if (stockType === "reserve") {
            inventory.reservedQty = Math.max(
              (inventory.reservedQty || 0) - qty,
              0,
            );
          }
          // else if (stockType === "offer") {
          //   inventory.offerQty = Math.max((inventory.offerQty || 0) - qty, 0);
          // }
        }

        // Update totalQty based on stock adjustments
        inventory.totalQty =
          (inventory.availableQty || 0) +
          (inventory.unsalableQty || 0) +
          (inventory.reservedQty || 0);
        // (inventory.offerQty || 0);

        if (
          isNaN(inventory.availableQty) ||
          isNaN(inventory.totalStockamtDlp) ||
          isNaN(inventory.totalStockamtRlp) ||
          isNaN(inventory.unsalableQty) ||
          isNaN(inventory.totalUnsalableamtDlp) ||
          isNaN(inventory.totalUnsalableStockamtRlp) ||
          // isNaN(inventory.offerQty) ||
          isNaN(inventory.reservedQty) ||
          isNaN(inventory.totalQty)
        ) {
          row.reason = `Invalid inventory calculations for Product code: ${productCode}`;
          skippedRows.push({ ...row });
          return;
        }

        await inventory.save();

        //causing the issue
        transactions.push({
          distributorId,
          transactionId: stockId,
          invItemId: inventory._id,
          productId: product._id,
          qty,
          date: new Date(),
          type: adjustmentType === "add" ? "In" : "Out",
          description: row.remarks,
          balanceCount:
            stockType === "salable"
              ? inventory.availableQty
              : stockType === "unsalable"
                ? inventory.unsalableQty
                : stockType === "reserve"
                  ? inventory.reservedQty
                  : inventory.offerQty,
          transactionType: "stockadjustment",
          stockType: stockType,
        });
      }),
    );

    // if (transactions.length > 0) {
    //   await Transaction.insertMany(transactions);
    // }

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

    // **NEW: Create DistributorTransaction for adjustment points if applicable**
    if (processedProducts?.length > 0 && totalAdjustmentPoints !== 0) {
      try {
        console.log(
          `Processing ${processedProducts.length} products for adjustment points calculation...`,
        );

        // **NEW: Fetch distributor details to check RBP scheme mapping**
        const distributor = await Distributor.findById(distributorId).lean();

        // console.log("fetched distributor details", distributor);

        if (!distributor) {
          console.log(`Distributor not found for ID: ${distributorId}`);
        } else if (distributor?.RBPSchemeMapped !== "yes") {
          console.log(
            `Skipping adjustment points calculation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
          );
        } else {
          console.log(
            `Creating distributor transaction for ${Math.abs(
              totalAdjustmentPoints,
            )} adjustment points for distributor ${distributor.dbCode}...`,
          );

          // Get the latest distributor transaction to calculate new balance
          const latestTransaction = await DistributorTransaction.findOne({
            distributorId: distributorId,
          }).sort({ createdAt: -1 });

          const currentBalance = latestTransaction
            ? Number(latestTransaction.balance)
            : 0;

          // Determine transaction type and ensure we have positive points for transaction
          const transactionType =
            totalAdjustmentPoints > 0 ? "credit" : "debit";
          const pointsToRecord = Math.abs(totalAdjustmentPoints);
          const newBalance =
            transactionType === "credit"
              ? currentBalance + pointsToRecord
              : Math.max(currentBalance - pointsToRecord, 0); // Prevent negative balance

          // Check if debit would cause negative balance
          if (transactionType === "debit" && currentBalance < pointsToRecord) {
            console.log(
              `Warning: Adjustment would cause negative balance. Current: ${currentBalance}, Attempting to debit: ${pointsToRecord}. Setting balance to 0.`,
            );
          }

          // Create the distributor transaction
          const distributorTransaction = new DistributorTransaction({
            distributorId: distributorId,
            transactionType,
            transactionFor: "Adjustment Point",
            point: Math.round(pointsToRecord),
            balance: newBalance,
            status: "Success",
            remark: `Stock adjustment points for ${processedProducts.length} products for DB Code ${distributor.dbCode} via adjustment`,
          });

          await distributorTransaction.save();

          console.log(
            `Successfully created distributor transaction: ${transactionType} ${Math.round(
              pointsToRecord,
            )} points for distributor ${
              distributor.dbCode
            }. New balance: ${newBalance}`,
          );
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
      // **NEW: Add adjustment points summary to response**
      adjustmentSummary: {
        totalProcessedProducts: processedProducts.length,
        totalAdjustmentPoints: Math.round(totalAdjustmentPoints),
        processedProducts: processedProducts.map((product) => ({
          productCode: product.productCode,
          adjustmentType: product.adjustmentType,
          qty: product.qty,
          basePoint: product.basePoint,
          points: product.points,
        })),
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
