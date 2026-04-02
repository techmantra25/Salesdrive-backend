/////////////// new logic stock type //////////////
const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const csv = require("csv-parser");
const fs = require("fs");
const { promises: fsPromises } = require("fs");
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

const bulkStockAdjustment = asyncHandler(async (req, res) => {
  try {
    const { csvUrl } = req.body;
    const distributorId = req.user?._id;

    if (!csvUrl) {
      return res.status(400).json({ message: "CSV URL is required" });
    }

    const fileName = `${uuidv4()}.csv`;
    const filePath = path.join(__dirname, fileName);

    // Download the file from the URL
    const response = await axios({
      method: "GET",
      url: csvUrl,
      responseType: "stream",
    });

    // Save the file locally
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      try {
        const results = [];
        const skippedRows = [];
        const transactions = [];
        const stockId = await transactionCode("LXSTA");
        let totalAdjustmentPoints = 0;
        const processedProducts = []; // Track processed products for logging

        fs.createReadStream(filePath)
          .pipe(
            csv({
              headers: [
                "Product code",
                "Product Name",
                "Adjustment",
                "Qty In Pcs",
                "Remarks",
                "Stock Type",
              ],
              skipLines: 1,
            }),
          )
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              await Promise.all(
                results.map(async (row, index) => {
                  const productCode = row["Product code"].trim();
                  const qty = parseInt(row["Qty In Pcs"], 10);
                  const adjustmentType = row["Adjustment"].trim().toLowerCase();
                  const stockType = row["Stock Type"].trim().toLowerCase();

                  if (isNaN(qty) || qty <= 0) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Invalid quantity for Product code: ${productCode}`,
                    });
                    return;
                  }

                  if (!["add", "reduce"].includes(adjustmentType)) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Invalid adjustment type for Product code: ${productCode}. Must be 'Add' or 'Reduce'`,
                    });
                    return;
                  }

                  if (!["salable", "unsalable", "offer"].includes(stockType)) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Invalid stock type for Product code: ${productCode}. Must be 'salable', 'unsalable', or 'offer'`,
                    });
                    return;
                  }

                  const product = await Product.findOne({
                    product_code: productCode,
                  });

                  if (!product) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Product with code ${productCode} not found`,
                    });
                    return;
                  }

                  const priceResponse = await axios.get(
                    `${SERVER_URL}/api/v1/price/product-pricing/${product._id}?distributorId=${req.user?._id}`,
                  );

                  const priceEntry = priceResponse?.data?.data[0];

                  if (!priceEntry) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `No price entry found for Product ID ${productCode}`,
                    });
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
                    skippedRows.push({
                      row: index + 1,
                      reason: `Invalid RLP or DLP price calculation for Product code: ${productCode}`,
                    });
                    return;
                  }

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

                  let inventory = await Inventory.findOne({
                    productId: product._id,
                    distributorId,
                  });

                  if (!inventory) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Inventory not found for Product code: ${productCode}`,
                    });
                    return;
                  }

                  // Adjust quantities and stock amounts based on the adjustment type and stock type


                  if (adjustmentType === "reduce") {
                    let currentStock;
                    
                    if (stockType === "salable") {
                      currentStock = inventory.availableQty || 0;
                    } else if (stockType === "unsalable") {
                      currentStock = inventory.unsalableQty || 0;
                    } else if (stockType === "offer") {
                      currentStock = inventory.offerQty || 0;
                    }
                    
                    if (currentStock < qty) {
                      skippedRows.push({
                        row: index + 1,
                        reason: `Insufficient ${stockType} stock for Product code: ${productCode}. Available: ${currentStock}, Requested: ${qty}`,
                      });
                      return;
                    }
                  }
                  if (adjustmentType === "add") {
                    if (stockType === "salable") {
                      inventory.availableQty += qty;
                      inventory.totalStockamtDlp += dlpbyPcs * qty;
                      inventory.totalStockamtRlp += rlpbyPcs * qty;
                    } else if (stockType === "unsalable") {
                      inventory.unsalableQty += qty;
                      inventory.totalUnsalableamtDlp += dlpbyPcs * qty;
                      inventory.totalUnsalableStockamtRlp += rlpbyPcs * qty;
                    } else if (stockType === "offer") {
                      inventory.offerQty += qty;
                    }
                  } else if (adjustmentType === "reduce") {
                    if (stockType === "salable") {
                      inventory.availableQty = Math.max(
                        inventory.availableQty - qty,
                        0,
                      );
                      inventory.totalStockamtDlp = Math.max(
                        inventory.totalStockamtDlp - dlpbyPcs * qty,
                        0,
                      );
                      inventory.totalStockamtRlp = Math.max(
                        inventory.totalStockamtRlp - rlpbyPcs * qty,
                        0,
                      );
                    } else if (stockType === "unsalable") {
                      inventory.unsalableQty = Math.max(
                        inventory.unsalableQty - qty,
                        0,
                      );
                      inventory.totalUnsalableamtDlp = Math.max(
                        inventory.totalUnsalableamtDlp - dlpbyPcs * qty,
                        0,
                      );
                      inventory.totalUnsalableStockamtRlp = Math.max(
                        inventory.totalUnsalableStockamtRlp - rlpbyPcs * qty,
                        0,
                      );
                    } else if (stockType === "offer") {
                      inventory.offerQty = Math.max(
                        inventory.offerQty - qty,
                        0,
                      );
                    }
                  }

                  // Calculate totalQty
                  inventory.totalQty =
                    inventory.availableQty +
                    inventory.unsalableQty +
                    inventory.offerQty;

                  // Save the inventory
                  await inventory.save();

                  // causing the issue
                  transactions.push({
                    distributorId,
                    transactionId: stockId,
                    invItemId: inventory._id,
                    productId: product._id,
                    qty,
                    date: new Date(),
                    type: adjustmentType === "add" ? "In" : "Out",
                    description: row["Remarks"],
                    balanceCount:
                      stockType === "salable"
                        ? inventory.availableQty
                        : stockType === "unsalable"
                          ? inventory.unsalableQty
                          : inventory.offerQty,
                    transactionType: "stockadjustment",
                    stockType,
                  });
                }),
              );

              // Insert transactions in bulk
              // await Transaction.insertMany(transactions);

              const createdTransactions =
                await Transaction.insertMany(transactions);

              // Create stock ledger entries in bulk
              try {
                await createBulkStockLedgerEntries(createdTransactions);
              } catch (error) {
                console.error(
                  "Bulk stock ledger creation failed:",
                  error.message,
                );
                // Don't throw - allow adjustment to continue
              }

              // **NEW: Create DistributorTransaction for adjustment points if applicable**
              if (
                processedProducts?.length > 0 &&
                totalAdjustmentPoints !== 0
              ) {
                try {
                  console.log(
                    `Processing ${processedProducts.length} products for adjustment points calculation...`,
                  );

                  // **NEW: Fetch distributor details to check RBP scheme mapping**
                  const distributor =
                    await Distributor.findById(distributorId).lean();

                  if (!distributor) {
                    console.log(
                      `Distributor not found for ID: ${distributorId}`,
                    );
                  } else if (distributor?.RBPSchemeMapped !== "yes") {
                    console.log(
                      `Skipping adjustment points calculation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
                    );
                  } else {
                    console.log(
                      `Creating distributor transaction for ${Math.abs(
                        totalAdjustmentPoints,
                      )} adjustment points for distributor ${
                        distributor.dbCode
                      }...`,
                    );

                    // Get the latest distributor transaction to calculate new balance
                    const latestTransaction =
                      await DistributorTransaction.findOne({
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
                    if (
                      transactionType === "debit" &&
                      currentBalance < pointsToRecord
                    ) {
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
                      remark: `Stock adjustment points for ${processedProducts.length} products for DB Code ${distributor.dbCode} via CSV adjustment`,
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
                  console.error(
                    "Error creating distributor transaction:",
                    pointsError,
                  );
                  // Don't fail the entire operation, just log the error
                }
              }

              // Delete the local file after processing
              await fsPromises.unlink(filePath);

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
              console.error("Error processing CSV data:", error.message);
              res.status(500).json({ message: error.message });
            }
          });
      } catch (error) {
        console.error("Error reading CSV file:", error.message);
        res.status(500).json({ message: error.message });
      }
    });

    writer.on("error", async (err) => {
      console.error("Error writing file:", err.message);
      await fsPromises.unlink(filePath);
      res.status(500).json({ message: "Error downloading file" });
    });
  } catch (error) {
    console.error("Error in bulk stock adjustment:", error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = { bulkStockAdjustment };
