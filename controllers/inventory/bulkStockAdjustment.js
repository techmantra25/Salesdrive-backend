/////////////// new logic stock type //////////////
const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const csv = require("csv-parser");
const fs = require("fs");
const { promises: fsPromises } = require("fs");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Godown = require("../../models/godown.model"); // NEW: needed to resolve Godown Code -> godownId
const Transaction = require("../../models/transaction.model");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
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

    const response = await axios({
      method: "GET",
      url: csvUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      try {
        const results = [];
        const skippedRows = [];
        const transactions = [];
        const stockId = await transactionCode("LXSTA");
        let totalAdjustmentPoints = 0;
        const processedProducts = [];

        // Cache Godown lookups per distributor so we don't hit the DB
        // once per CSV row for the same godown code.
        const godownCache = new Map();

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
                "Godown Code", // NEW: which godown this row's stock belongs to
              ],
              skipLines: 1,
            }),
          )
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              await Promise.all(
                results.map(async (row, index) => {
                  const productCode = row["Product code"]?.trim();
                  const qty = parseInt(row["Qty In Pcs"], 10);
                  const adjustmentType = row["Adjustment"]?.trim().toLowerCase();
                  const stockType = row["Stock Type"]?.trim().toLowerCase();
                  const godownCode = row["Godown Code"]?.trim();

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

                  // ---- NEW: Godown is now required per row ----
                  if (!godownCode) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Godown Code is required for Product code: ${productCode}`,
                    });
                    return;
                  }

                  let godown = godownCache.get(godownCode);
                  if (godown === undefined) {
                    godown = await Godown.findOne({
                      distributorId,
                      godownCode,
                      isActive: true,
                    }).lean();
                    godownCache.set(godownCode, godown || null);
                  }

                  if (!godown) {
                    skippedRows.push({
                      row: index + 1,
                      reason: `Godown Code "${godownCode}" not found (or inactive) for this distributor. Product code: ${productCode}`,
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

                  const basePoint = Number(product.base_point) || 0;
                  let productAdjustmentPoints = 0;
                  if (basePoint > 0) {
                    if (adjustmentType === "add") {
                      productAdjustmentPoints = basePoint * qty;
                      totalAdjustmentPoints += productAdjustmentPoints;
                    } else if (adjustmentType === "reduce") {
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

                  // ------------------------------------------------------------------
                  // ATOMIC INVENTORY UPDATE (race-condition safe)
                  // ------------------------------------------------------------------
                  // Previous version did: findOne -> mutate in JS -> save().
                  // Under Promise.all, concurrent rows touching the same
                  // (productId, distributorId, godownId) would read the same
                  // stale snapshot and the later .save() would clobber the
                  // earlier one's write — silently dropping an adjustment.
                  //
                  // Fix: use a single atomic findOneAndUpdate with $inc, which
                  // MongoDB guarantees is applied atomically server-side even
                  // under concurrent requests. Also scope strictly by
                  // godownId (not just productId+distributorId) so a bulk
                  // upload never guesses which godown's stock to touch, and
                  // upsert so a brand-new (product, godown) pair gets created
                  // correctly with godownId/godownType set from the start —
                  // this is the root cause of the earlier "combine across
                  // godowns" bug, where a doc existed with no godown info.

                  const qtyField =
                    stockType === "salable"
                      ? "availableQty"
                      : stockType === "unsalable"
                      ? "unsalableQty"
                      : "offerQty";

                  const dlpAmtField =
                    stockType === "salable"
                      ? "totalStockamtDlp"
                      : stockType === "unsalable"
                      ? "totalUnsalableamtDlp"
                      : null;

                  const rlpAmtField =
                    stockType === "salable"
                      ? "totalStockamtRlp"
                      : stockType === "unsalable"
                      ? "totalUnsalableStockamtRlp"
                      : null;

                  const signedQty = adjustmentType === "add" ? qty : -qty;
                  const signedDlpAmt = dlpAmtField
                    ? (adjustmentType === "add" ? qty : -qty) * dlpbyPcs
                    : 0;
                  const signedRlpAmt = rlpAmtField
                    ? (adjustmentType === "add" ? qty : -qty) * rlpbyPcs
                    : 0;

                  const filter = {
                    productId: product._id,
                    distributorId,
                    godownId: godown._id,
                  };

                  // For "reduce", guard against going negative atomically by
                  // requiring currentStock >= qty as part of the filter. If
                  // that condition fails to match, findOneAndUpdate returns
                  // null (row is skipped below) instead of racing on a
                  // separate read-then-check.
                  if (adjustmentType === "reduce") {
                    filter[qtyField] = { $gte: qty };
                  }

                  const inc = { [qtyField]: signedQty, totalQty: signedQty };
                  if (dlpAmtField) inc[dlpAmtField] = signedDlpAmt;
                  if (rlpAmtField) inc[rlpAmtField] = signedRlpAmt;

                  const updatedInventory = await Inventory.findOneAndUpdate(
                    filter,
                    {
                      $inc: inc,
                      // productId/distributorId/godownId are already part of
                      // `filter` above, so MongoDB sets them automatically on
                      // upsert-insert — no $setOnInsert needed for those.
                      // godownType is intentionally NOT set here: the read
                      // pipeline no longer filters on it (see inventory list
                      // controller), so it's not required for correctness.
                    },
                    {
                      new: true,
                      upsert: adjustmentType === "add", // never create a doc just to reduce it
                      setDefaultsOnInsert: true,
                    },
                  );

                  if (!updatedInventory) {
                    // Either reduce failed the $gte guard (insufficient
                    // stock) or no doc exists to reduce from.
                    skippedRows.push({
                      row: index + 1,
                      reason:
                        adjustmentType === "reduce"
                          ? `Insufficient ${stockType} stock for Product code: ${productCode} at godown ${godownCode} (requested ${qty})`
                          : `Inventory not found for Product code: ${productCode} at godown ${godownCode}`,
                    });
                    return;
                  }

                  // Clamp amount fields at 0 defensively (in case of prior
                  // negative drift in the data); doesn't affect qty which is
                  // already guarded above.
                  if (
                    (dlpAmtField && updatedInventory[dlpAmtField] < 0) ||
                    (rlpAmtField && updatedInventory[rlpAmtField] < 0)
                  ) {
                    await Inventory.updateOne(filter, {
                      $max: {
                        ...(dlpAmtField ? { [dlpAmtField]: 0 } : {}),
                        ...(rlpAmtField ? { [rlpAmtField]: 0 } : {}),
                      },
                    });
                  }

                  transactions.push({
                    distributorId,
                    transactionId: stockId,
                    invItemId: updatedInventory._id,
                    productId: product._id,
                    godownId: godown._id,
                    qty,
                    date: new Date(),
                    type: adjustmentType === "add" ? "In" : "Out",
                    description: row["Remarks"],
                    balanceCount: updatedInventory[qtyField],
                    transactionType: "stockadjustment",
                    stockType,
                  });
                }),
              );

              const createdTransactions =
                await Transaction.insertMany(transactions);

              try {
                await createBulkStockLedgerEntries(createdTransactions);
              } catch (error) {
                console.error(
                  "Bulk stock ledger creation failed:",
                  error.message,
                );
              }

              if (processedProducts?.length > 0 && totalAdjustmentPoints !== 0) {
                try {
                  const distributor =
                    await Distributor.findById(distributorId).lean();

                  if (!distributor) {
                    console.log(`Distributor not found for ID: ${distributorId}`);
                  } else if (distributor?.RBPSchemeMapped !== "yes") {
                    console.log(
                      `Skipping adjustment points calculation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
                    );
                  } else {
                    const latestTransaction =
                      await DistributorTransaction.findOne({
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
                      remark: `Stock adjustment points for ${processedProducts.length} products for DB Code ${distributor.dbCode} via CSV adjustment`,
                    });

                    await distributorTransaction.save();
                  }
                } catch (pointsError) {
                  console.error(
                    "Error creating distributor transaction:",
                    pointsError,
                  );
                }
              }

              await fsPromises.unlink(filePath);

              res.status(201).json({
                message: "Stock adjustment processed successfully",
                transactions,
                skippedRows,
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