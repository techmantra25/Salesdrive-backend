const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");
const Inventory = require("../../models/inventory.model");
const Distributor = require("../../models/distributor.model");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const { generateCode, transactionCode } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const { createBulkStockLedgerEntries } = require("../../controllers/transction/createStockLedgerEntry"); 

// Helper to parse a CSV line with quoted fields
const parseCSVLine = (line) => {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

// Helper function to chunk array
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Improved pricing fetch with retry logic and better error handling
const fetchPricingWithRetry = async (productId, distributorId, retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        `${SERVER_URL}/api/v1/price/product-pricing/${productId}?distributorId=${distributorId}`,
        {
          timeout: 15000, // Reduced timeout
          headers: {
            Connection: "keep-alive",
            "Keep-Alive": "timeout=5, max=1000",
          },
        },
      );
      return { success: true, data: response.data };
    } catch (error) {
      if (attempt === retries) {
        return {
          success: false,
          error: error.message,
          productId,
        };
      }
      // Shorter backoff for faster processing
      await delay(attempt * 500);
    }
  }
};

const bulkOpeningStock = asyncHandler(async (req, res) => {
  const { secure_url, url } = req.body;
  const distributorId = req.user?._id;
  const csvUrl = secure_url || url || req.body.csvUrl;

  if (!csvUrl) {
    return res.status(400).json({
      message: "CSV URL is required (secure_url, url, or csvUrl)",
    });
  }

  // **CRITICAL FIX: Add locking mechanism to prevent concurrent uploads**
  const lockKey = `bulk_opening_stock_${distributorId}`;
  console.log(`🔒 [${lockKey}] Attempting to acquire lock...`);

  if (!(await acquireLock(lockKey))) {
    return res.status(409).json({
      message:
        "Another bulk upload is already in progress. Please wait and try again.",
      error: "UPLOAD_IN_PROGRESS",
    });
  }

  console.log(`✅ [${lockKey}] Lock acquired.`);

  const fileName = `${uuidv4()}.csv`;
  const filePath = path.join(__dirname, fileName);
  const skippedRows = [];

  try {
    console.log("Starting bulk opening stock upload...");

    // Download CSV file with better error handling
    const response = await axios.get(csvUrl, {
      responseType: "stream",
      timeout: 60000,
      maxContentLength: 100 * 1024 * 1024, // 100MB limit
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      setTimeout(() => reject(new Error("File download timeout")), 60000);
    });

    // **OPTIMIZED CSV PARSING**
    const results = [];
    await new Promise((resolve, reject) => {
      let rowCount = 0;
      const stream = fs
        .createReadStream(filePath)
        .pipe(
          csv({
            headers: [
              "Product code",
              "Product Name",
              "Qty In Pcs",
              "Stock Type",
            ],
            skipLines: 1,
          }),
        )
        .on("data", (data) => {
          rowCount++;
          // **MEMORY OPTIMIZATION: Limit max rows**
          if (rowCount > 5000) {
            stream.destroy();
            reject(new Error("CSV file too large. Maximum 5000 rows allowed."));
            return;
          }

          if (
            data["Product code"] &&
            !data["Product Name"] &&
            !data["Qty In Pcs"] &&
            !data["Stock Type"]
          ) {
            const rawLine = data["Product code"];
            const parsed = parseCSVLine(rawLine);
            if (parsed.length >= 4) {
              results.push({
                "Product code": parsed[0].trim(),
                "Product Name": parsed[1].replace(/^"|"$/g, "").trim(),
                "Qty In Pcs": parsed[2].trim(),
                "Stock Type": parsed[3].trim(),
              });
            } else {
              results.push({ ...data, parseError: true });
            }
          } else {
            results.push(data);
          }
        })
        .on("end", resolve)
        .on("error", reject);

      setTimeout(() => {
        stream.destroy();
        reject(new Error("CSV parsing timeout"));
      }, 120000);
    });

    console.log(`Parsed ${results.length} rows from CSV`);

    // **IMPROVED DUPLICATE DETECTION**
    const freq = {};
    results.forEach((row, index) => {
      const code = (row["Product code"] || "").trim();
      if (code) {
        if (!freq[code]) freq[code] = [];
        freq[code].push(index + 1);
      }
    });

    // Get distributor with godown info + brand
    const distributor = await Distributor.findById(distributorId)
      .select("goDown brandId RBPSchemeMapped dbCode")
      .lean();

    if (!distributor) {
      throw new Error("Distributor not found");
    }

    // Create a Set of distributor's brand IDs for O(1) lookup
    const distributorBrandSet = new Set(
      (distributor.brandId || []).map((id) => id.toString()),
    );

    console.log("=== BRAND VALIDATION DEBUG ===");
    console.log(`Distributor: ${distributor.dbCode}`);
    console.log(`Mapped Brands (${distributorBrandSet.size}):`, [
      ...distributorBrandSet,
    ]);

    const { goDown = ["main"] } = distributor;

    // **OPTIMIZED VALIDATION**
    const validRows = [];
    const productCodes = new Set();

    for (let i = 0; i < results.length; i++) {
      const rowNum = i + 1;
      const row = results[i];

      if (row.parseError) {
        row.reason = `Failed to parse CSV line at row ${rowNum}`;
        skippedRows.push(row);
        continue;
      }

      const productCode = (row["Product code"] || "").trim();
      if (!productCode) {
        row.reason = `Missing product code at row ${rowNum}`;
        skippedRows.push(row);
        continue;
      }

      // **IMPROVED DUPLICATE CHECK**
      if (freq[productCode] && freq[productCode].length > 1) {
        row.reason = `Duplicate product code '${productCode}' found in rows: ${freq[
          productCode
        ].join(", ")}`;
        skippedRows.push(row);
        continue;
      }

      const qtyStr = (row["Qty In Pcs"] || "").trim();
      const stockType = (row["Stock Type"] || "").toLowerCase().trim();

      const qty = parseInt(qtyStr, 10);
      if (isNaN(qty) || qty < 0) {
        row.reason = `Invalid quantity '${qtyStr}' at row ${rowNum}`;
        skippedRows.push(row);
        continue;
      }

      if (!["salable", "unsalable", "offer"].includes(stockType)) {
        row.reason = `Invalid stock type '${stockType}' at row ${rowNum}. Must be: salable, unsalable, or offer`;
        skippedRows.push(row);
        continue;
      }

      validRows.push({ ...row, qty, stockType, rowNum });
      productCodes.add(productCode);
    }

    console.log(
      `${validRows.length} valid rows, ${skippedRows.length} skipped rows`,
    );

    if (validRows.length === 0) {
      return res.status(200).json({
        message: "No valid data to process",
        skippedRows,
      });
    }

    // **CRITICAL FIX: Check for existing inventory AFTER acquiring lock**
    console.log("Fetching products and validating brand authorization...");

    const products = await Product.find({
      product_code: { $in: Array.from(productCodes) },
    }).lean();

    console.log(`Found ${products.length} products in database`);

    // Create a map for quick product lookup
    const productByCode = new Map();
    products.forEach((p) => productByCode.set(p.product_code, p));

    // NEW: Filter products by brand authorization
    const authorizedRows = [];
    const brandMismatchCount = { total: 0, details: [] };

    for (const row of validRows) {
      const productCode = row["Product code"].trim();
      const product = productByCode.get(productCode);

      if (!product) {
        row.reason = `Product code '${productCode}' not found in database (row ${row.rowNum})`;
        skippedRows.push(row);
        continue;
      }

      // Check if product has a brand
      if (!product.brand) {
        row.reason = `Product '${productCode}' has no brand mapped (row ${row.rowNum})`;
        skippedRows.push(row);
        console.warn(`⚠️ No brand for product:  ${productCode}`);
        continue;
      }

      // CRITICAL: Brand authorization check
      const productBrandId = product.brand.toString();
      if (!distributorBrandSet.has(productBrandId)) {
        // Brand mismatch - reject this row
        row.reason = `Brand mismatch: Product  ${productCode}`;
        skippedRows.push(row);

        // Log detailed mismatch info
        brandMismatchCount.total++;
        brandMismatchCount.details.push({
          row: row.rowNum,
          productCode: productCode,
          productBrand: productBrandId,
          distributorCode: distributor.dbCode,
          allowedBrands: [...distributorBrandSet],
        });

        console.error(`❌ BRAND MISMATCH at row  ${row.rowNum}:`, {
          product: productCode,
          productBrand: productBrandId,
          distributorBrands: [...distributorBrandSet],
        });

        continue;
      }

      // Brand matches - authorize this product
      authorizedRows.push({ ...row, product });
    }

    // Log brand validation summary
    console.log("=== BRAND VALIDATION SUMMARY ===");
    console.log(`✅ Authorized products: ${authorizedRows.length}`);
    console.log(`❌ Brand mismatches: ${brandMismatchCount.total}`);

    if (brandMismatchCount.total > 0) {
      console.error(
        "🚨 BRAND MISMATCH DETAILS:",
        JSON.stringify(brandMismatchCount.details, null, 2),
      );
    }

    if (authorizedRows.length === 0) {
      return res.status(200).json({
        message:
          "No authorized products found. All products failed brand validation.",
        skippedRows,
        brandMismatchCount: brandMismatchCount.total,
        brandMismatchDetails: brandMismatchCount.details,
      });
    }

    // Continue with authorized products only
    const productIds = authorizedRows.map((r) => r.product._id);
    const authorizedProducts = authorizedRows.map((r) => r.product);
    const productChunks = chunkArray(authorizedProducts, 50);

    // **IMPROVED EXISTING INVENTORY CHECK**
    const existingInventory = await Inventory.find({
      productId: { $in: productIds },
      distributorId,
    }).lean();

    const existingInventorySet = new Set();
    existingInventory.forEach((inv) => {
      existingInventorySet.add(inv.productId.toString());
    });

    console.log(
      `Found ${existingInventory.length} existing opening stock records`,
    );

    // **OPTIMIZED PRICING FETCH - Smaller chunks for better performance**
    console.log("Fetching pricing data in optimized chunks...");
    const pricingMap = new Map();

    for (let chunkIndex = 0; chunkIndex < productChunks.length; chunkIndex++) {
      const chunk = productChunks[chunkIndex];
      console.log(
        `Processing pricing chunk ${chunkIndex + 1}/${productChunks.length} (${
          chunk.length
        } products)`,
      );

      // **SEQUENTIAL PROCESSING to avoid overwhelming the API**
      for (let i = 0; i < chunk.length; i++) {
        const product = chunk[i];

        try {
          const result = await fetchPricingWithRetry(
            product._id,
            distributorId,
          );

          if (result.success) {
            const priceEntry = result.data?.data?.[0];
            if (priceEntry) {
              pricingMap.set(product._id.toString(), priceEntry);
            }
          } else {
            console.log(
              `Failed to fetch pricing for ${product.product_code}:`,
              result.error,
            );
          }
        } catch (error) {
          console.error(
            `Error fetching pricing for ${product.product_code}:`,
            error.message,
          );
        }

        // **RATE LIMITING: 300ms delay between requests**
        if (i < chunk.length - 1) {
          await delay(300);
        }
      }

      // Longer delay between chunks
      if (chunkIndex < productChunks.length - 1) {
        await delay(1000);
      }
    }

    console.log(`Successfully fetched pricing for ${pricingMap.size} products`);

    // **OPTIMIZED DATA PROCESSING WITH SMALLER CHUNKS**
    const processedData = [];
    const finalValidRows = [];

    // **FILTER OUT EXISTING INVENTORY BEFORE PROCESSING**
    for (const row of authorizedRows) {
      const productCode = row["Product code"].trim();
      const { product } = row;

      if (!product) {
        row.reason = `No product found with code ${productCode} at row ${row.rowNum}`;
        skippedRows.push(row);
        continue;
      }

      // **CRITICAL FIX: Check if opening stock already exists**
      if (existingInventorySet.has(product._id.toString())) {
        row.reason = `Opening stock already exists for product code ${productCode}`;
        skippedRows.push(row);
        continue;
      }

      const priceEntry = pricingMap.get(product._id.toString());
      if (!priceEntry) {
        row.reason = `No price entry found for ${productCode} at row ${row.rowNum}`;
        skippedRows.push(row);
        continue;
      }

      finalValidRows.push({ ...row, product, priceEntry });
    }

    console.log(
      `${finalValidRows.length} rows ready for processing after final validation`,
    );

    if (finalValidRows.length === 0) {
      return res.status(200).json({
        message:
          "No new records to process. All products already have opening stock or failed validation.",
        skippedRows,
        brandMismatchCount: brandMismatchCount.total,
      });
    }

    // **PROCESS IN SMALLER CHUNKS FOR BETTER MEMORY MANAGEMENT**
    const rowChunks = chunkArray(finalValidRows, 50); // Smaller chunks

    let totalOpeningStockPoints = 0;

    for (let chunkIndex = 0; chunkIndex < rowChunks.length; chunkIndex++) {
      const chunk = rowChunks[chunkIndex];
      console.log(
        `Processing data chunk ${chunkIndex + 1}/${rowChunks.length} (${
          chunk.length
        } rows)`,
      );

      try {
        const inventoriesToInsert = [];
        const transactionsToInsert = [];
        const chunkProcessedRows = [];
        let chunkPoints = 0; // Track points for this chunk

        // **GENERATE BATCH IDs FOR BETTER PERFORMANCE**
        const txnIds = {};
        for (const row of chunk) {
          if (!txnIds[row.product._id]) {
            txnIds[row.product._id] = await transactionCode("LXSTA");
          }
        }

        for (const row of chunk) {
          const { product, priceEntry } = row;

          // Calculate per-piece pricing
          let rlpbyPcs, dlpbyPcs;
          if (product.uom === "box") {
            const ppk = product.no_of_pieces_in_a_box || 1;
            rlpbyPcs = (priceEntry.rlp_price || 0) / ppk;
            dlpbyPcs = (priceEntry.dlp_price || 0) / ppk;
          } else {
            rlpbyPcs = priceEntry.rlp_price || 0;
            dlpbyPcs = priceEntry.dlp_price || 0;
          }

          if (isNaN(rlpbyPcs) || isNaN(dlpbyPcs)) {
            row.reason = `Invalid price calculation for ${product.product_code} at row ${row.rowNum}`;
            skippedRows.push(row);
            continue;
          }

          // **NEW: Calculate opening stock points only for salable quantity**
          if (row.stockType === "salable") {
            const basePoint = Number(product.base_point) || 0;
            if (basePoint > 0) {
              chunkPoints += basePoint * Number(row.qty);
            }
          }

          const txnId = txnIds[product._id];

          // Create inventory records for each godown
          for (const godownType of goDown) {
            const invId = await generateCode("INVT");

            let availableQty = 0,
              unsalableQty = 0,
              offerQty = 0;
            if (row.stockType === "salable") availableQty = row.qty;
            if (row.stockType === "unsalable") unsalableQty = row.qty;
            if (row.stockType === "offer") offerQty = row.qty;

            const inventoryDoc = {
              productId: product._id,
              distributorId,
              invitemId: invId,
              godownType,
              availableQty,
              unsalableQty,
              offerQty,
              totalQty: availableQty + unsalableQty + offerQty,
              totalStockamtDlp: dlpbyPcs * availableQty,
              totalStockamtRlp: rlpbyPcs * availableQty,
              totalUnsalableamtDlp: dlpbyPcs * unsalableQty,
              totalUnsalableStockamtRlp: rlpbyPcs * unsalableQty,
              intransitQty: 0,
              undeliveredQty: 0,
              normsQty: 0,
              openingStock: true, // **CRITICAL: Mark as opening stock**
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            inventoriesToInsert.push(inventoryDoc);

            // Create transaction records
            const createTransaction = (qty, stockType) => {
              if (qty > 0) {
                transactionsToInsert.push({
                  distributorId,
                  transactionId: txnId,
                  invItemId: null, // Will be updated after inventory insertion
                  productId: product._id,
                  qty,
                  date: new Date(),
                  type: "In",
                  description: `Opening stock for ${product.product_code}`,
                  balanceCount: qty,
                  transactionType: "openingstock",
                  stockType,
                  godownType,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            };

            createTransaction(availableQty, "salable");
            createTransaction(unsalableQty, "unsalable");
            createTransaction(offerQty, "offer");
          }

          chunkProcessedRows.push(row);
        }

        // **BATCH INSERT WITH BETTER ERROR HANDLING**
        if (inventoriesToInsert.length > 0) {
          console.log(
            `Inserting ${inventoriesToInsert.length} inventory records...`,
          );

          const insertedInventories = await Inventory.insertMany(
            inventoriesToInsert,
            { ordered: false },
          );

          console.log(
            `Successfully inserted ${insertedInventories.length} inventory records`,
          );

          // **UPDATE EXISTING INVENTORY SET TO PREVENT DUPLICATES IN SUBSEQUENT CHUNKS**
          insertedInventories.forEach((inv) => {
            existingInventorySet.add(inv.productId.toString());
          });

          // Update transaction records with inventory IDs
          const inventoryMap = new Map();
          insertedInventories.forEach((inv) => {
            const key = `${inv.productId}_${inv.godownType}`;
            inventoryMap.set(key, inv._id);
          });

          // Update transactions with correct invItemId
          transactionsToInsert.forEach((txn) => {
            const key = `${txn.productId}_${txn.godownType}`;
            txn.invItemId = inventoryMap.get(key);
          });

          // Batch insert transactions
          // if (transactionsToInsert.length > 0) {
          //   console.log(
          //     `Inserting ${transactionsToInsert.length} transaction records...`
          //   );

          //   await Transaction.insertMany(transactionsToInsert, {
          //     ordered: false,
          //   });

          //   console.log(
          //     `Successfully inserted ${transactionsToInsert.length} transaction records`
          //   );
          // }

          // Batch insert transactions
          if (transactionsToInsert.length > 0) {
            console.log(
              `Inserting ${transactionsToInsert.length} transaction records...`,
            );

            const insertedTransactions = await Transaction.insertMany(
              transactionsToInsert,
              {
                ordered: false,
              },
            );

            console.log(
              `Successfully inserted ${insertedTransactions.length} transaction records`,
            );

            // **NEW: Create stock ledger entries for all inserted transactions**
            try {
              await createBulkStockLedgerEntries(insertedTransactions);
              console.log(
                `✅ Stock ledger entries created for ${insertedTransactions.length} transactions`,
              );
            } catch (ledgerError) {
              console.error(
                "Error creating stock ledger entries:",
                ledgerError,
              );
              // Don't fail the entire operation, just log the error
            }
          }
        }
        // **NEW: Add chunk points to total**
        totalOpeningStockPoints += chunkPoints;
        processedData.push(...chunkProcessedRows);
        console.log(
          `Successfully processed chunk ${chunkIndex + 1}: ${
            chunkProcessedRows.length
          } rows`,
        );
      } catch (error) {
        console.error(`Error processing chunk ${chunkIndex + 1}:`, error);

        // Add all rows from failed chunk to skipped rows
        chunk.forEach((row) => {
          row.reason = `Processing failed for chunk at row ${row.rowNum}: ${error.message}`;
          skippedRows.push(row);
        });
      }

      // **MEMORY CLEANUP AND RATE LIMITING**
      if (global.gc) {
        global.gc();
      }
      await delay(500);
    }

    // **NEW: Create distributor transaction for opening stock points**
    if (processedData.length > 0 && totalOpeningStockPoints > 0) {
      try {
        console.log(
          `Checking RBP scheme mapping for distributor ${distributor.dbCode}...`,
        );

        // **NEW: Check if distributor is mapped to RBP scheme**
        if (distributor.RBPSchemeMapped !== "yes") {
          console.log(
            `Skipping distributor transaction - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
          );
        } else {
          console.log(
            `Creating distributor transaction for ${totalOpeningStockPoints} opening stock points...`,
          );

          // Get the latest distributor transaction to calculate new balance
          const latestTransaction = await DistributorTransaction.findOne({
            distributorId: distributorId,
          }).sort({ createdAt: -1 });

          const currentBalance = latestTransaction
            ? Number(latestTransaction.balance)
            : 0;
          const newBalance =
            currentBalance + Math.round(totalOpeningStockPoints);

          // Create the distributor transaction
          const distributorTransaction = new DistributorTransaction({
            distributorId: distributorId,
            transactionType: "credit",
            transactionFor: "Opening Points",
            point: Math.round(totalOpeningStockPoints),
            balance: newBalance,
            status: "Success",
            remark: `Opening stock points for ${processedData.length} products for DB Code ${distributor.dbCode} uploaded via bulk CSV`,
          });

          await distributorTransaction.save();

          console.log(
            `Successfully created distributor transaction with ${Math.round(
              totalOpeningStockPoints,
            )} points for distributor ${distributor.dbCode}`,
          );
        }
      } catch (pointsError) {
        console.error("Error creating distributor transaction:", pointsError);
        // Don't fail the entire operation, just log the error
      }
    }

    console.log(
      `Upload completed. Processed: ${processedData.length}, Skipped: ${skippedRows.length}, Points Credited: ${totalOpeningStockPoints}`,
    );

    res.status(201).json({
      message: `Successfully processed ${processedData.length} records`,
      data: processedData.map((row) => ({
        productCode: row["Product code"],
        qty: row.qty,
        stockType: row.stockType,
        rowNum: row.rowNum,
      })),
      skippedRows,
      summary: {
        totalRows: results.length,
        validRows: validRows.length,
        authorizedRows: authorizedRows.length,
        processedRows: processedData.length,
        skippedRows: skippedRows.length,
        brandMismatches: brandMismatchCount.total,
        pricingFetched: pricingMap.size,
        productsFound: products.length,
        existingInventoryFound: existingInventory.length,
        totalOpeningStockPoints: totalOpeningStockPoints,
      },
      // Include brand mismatch details if any
      ...(brandMismatchCount.total > 0 && {
        brandValidationErrors: {
          count: brandMismatchCount.total,
          details: brandMismatchCount.details,
        },
      }),
    });
  } catch (err) {
    console.error("Bulk opening stock error:", err);

    res.status(500).json({
      message: err.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? err.stack : undefined,
      skippedRows: skippedRows.length > 0 ? skippedRows : undefined,
    });
  } finally {
    // **CRITICAL: Always cleanup and release lock**
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        console.error("Error cleaning up file:", cleanupError);
      }
    }

    await releaseLock(lockKey);
    console.log(`🔓 [${lockKey}] Lock released.`);
  }
});

module.exports = { bulkOpeningStock };
