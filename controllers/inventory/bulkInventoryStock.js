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
const Price = require("../../models/price.model");
const Region = require("../../models/region.model");
const { generateCode, transactionCode } = require("../../utils/codeGenerator");
const moment = require("moment-timezone");
const {
  createBulkStockLedgerEntries,
} = require("../../controllers/transction/createStockLedgerEntry");

const bulkInventoryStock = asyncHandler(async (req, res) => {
  try {
    const { csvUrl } = req.body;
    const distributorId = req.user?._id; // Take distributor ID from authentication

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
      const results = [];

      // Read and parse the downloaded CSV file
      fs.createReadStream(filePath)
        .pipe(
          csv({
            headers: ["Product code", "Product Name", "Qty In Pcs"],
            skipLines: 1, // Skip the header row in your CSV file
          }),
        )
        .on("data", (data) => results.push(data))
        .on("end", async () => {
          try {
            const transactions = [];

            // Process each row from the CSV
            await Promise.all(
              results.map(async (row, index) => {
                const productCode = row["Product code"].trim();
                const qty = parseInt(row["Qty In Pcs"], 10);

                if (isNaN(qty) || qty <= 0) {
                  throw new Error(
                    `Invalid quantity for Product code: ${productCode} at row ${
                      index + 1
                    }`,
                  );
                }

                const product = await Product.findOne({
                  product_code: productCode,
                });

                if (!product) {
                  throw new Error(
                    `Product with code ${productCode} not found at row ${
                      index + 1
                    }`,
                  );
                }

                // Check for distributor-specific price first
                let priceEntry = await Price.findOne({
                  productId: product._id,
                  distributorId: req.user?._id, // Use distributor ID from authentication
                  status: true,
                }).sort({ effective_date: -1 });

                if (!priceEntry) {
                  // If no distributor price found, fall back to regional price
                  const distributor = await Distributor.findOne({
                    _id: req.user?._id,
                  });
                  const region = await Region.findOne({
                    _id: distributor.regionId,
                  });

                  if (!region) {
                    throw new Error(
                      `Region with ID ${distributor.regionId} not found`,
                    );
                  }

                  priceEntry = await Price.findOne({
                    productId: product._id,
                    regionId: region._id,
                    status: true,
                    price_type: "regional",
                  }).sort({ effective_date: -1 });

                  if (!priceEntry) {
                    throw new Error(
                      `No price entry found for Product ID ${
                        product._id
                      } at row ${index + 1}`,
                    );
                  }
                }

                // Validate price effective and expiration date
                const nowDateTime = moment().tz("Asia/Kolkata").toDate();
                const effectiveDate = moment(priceEntry.effective_date)
                  .tz("Asia/Kolkata")
                  .startOf("day")
                  .toDate();
                const expiresAt = priceEntry.expiresAt
                  ? moment(priceEntry.expiresAt)
                      .tz("Asia/Kolkata")
                      .endOf("day")
                      .toDate()
                  : null;

                if (
                  moment(effectiveDate).isAfter(nowDateTime) ||
                  (expiresAt && moment(expiresAt).isBefore(nowDateTime))
                ) {
                  throw new Error(
                    `Price for Product ID ${product._id} is not valid on ${nowDateTime}`,
                  );
                }

                // Calculate price per piece or box
                let rlpbyPcs = 0;
                let dlpbyPcs = 0;

                // Check if the UOM is box or pieces and calculate accordingly
                if (product?.uom === "box") {
                  const piecesPerBox = product?.no_of_pieces_in_a_box || 1;
                  rlpbyPcs = priceEntry?.rlp_price / piecesPerBox;
                  dlpbyPcs = priceEntry?.dlp_price / piecesPerBox;
                } else {
                  rlpbyPcs = priceEntry?.rlp_price || 0;
                  dlpbyPcs = priceEntry?.dlp_price || 0;
                }

                if (isNaN(rlpbyPcs) || isNaN(dlpbyPcs)) {
                  throw new Error(
                    `Invalid RLP or DLP price calculation for Product code: ${productCode} at row ${
                      index + 1
                    }`,
                  );
                }

                // Find the inventory by productId and distributorId
                let inventory = await Inventory.findOne({
                  productId: product._id,
                  distributorId, // Use distributor ID from authentication
                  godownType: "main", // Only update the main inventory
                });

                const inventoryItemId = await generateCode("INVT");

                if (!inventory) {
                  // If inventory not found, create both main and damaged inventory

                  // Create main inventory
                  inventory = new Inventory({
                    productId: product._id,
                    distributorId: req.user?._id,
                    invitemId: inventoryItemId,
                    godownType: "main",
                    intransitQty: 0,
                    undeliveredQty: 0,
                    availableQty: qty, // Initial quantity from CSV
                    totalStockamtDlp: dlpbyPcs * qty,
                    totalStockamtRlp: rlpbyPcs * qty,
                    normsQty: 0,
                  });
                  await inventory.save();

                  // Create damaged inventory with damagedQty initialized to 0
                  const damagedInventory = new Inventory({
                    productId: product._id,
                    distributorId: req.user?._id,
                    invitemId: inventoryItemId,
                    godownType: "damaged",
                    damagedQty: 0,
                  });
                  await damagedInventory.save();

                  const distributorUpdate = await Distributor.findOneAndUpdate(
                    { _id: req.user?._id },
                    {
                      openingStock: true,
                    },
                    {
                      new: true,
                    },
                  );
                } else {
                  // Update the existing main inventory
                  inventory.availableQty =
                    (inventory.availableQty || 0) + qty || 0;
                  inventory.totalStockamtDlp =
                    (inventory.totalStockamtDlp || 0) + dlpbyPcs * qty || 0;
                  inventory.totalStockamtRlp =
                    (inventory.totalStockamtRlp || 0) + rlpbyPcs * qty || 0;

                  // Ensure values are numbers before updating inventory
                  if (
                    isNaN(inventory.availableQty) ||
                    isNaN(inventory.totalStockamtDlp) ||
                    isNaN(inventory.totalStockamtRlp)
                  ) {
                    throw new Error(
                      `Invalid inventory calculations for Product code: ${productCode} at row ${
                        index + 1
                      }`,
                    );
                  }

                  await inventory.save();
                }

                // Create transaction entry
                const stockId = await transactionCode("LXSTA");
                transactions.push({
                  distributorId, // Use distributor ID from authentication
                  transactionId: stockId,
                  invItemId: inventory?._id,
                  productId: product._id,
                  qty,
                  date: new Date(),
                  type: "In",
                  description: `Bulk update from CSV for Product ID: ${product._id}`,
                  balanceCount: inventory?.availableQty,
                });
              }),
            );

            // Insert transactions in bulk
            // await Transaction.insertMany(transactions);

            // // Delete the local file after processing
            // fs.unlinkSync(filePath);

            // res.status(201).json({ message: "Inventory updated successfully" });

            // Insert transactions in bulk
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
              // Don't throw - allow inventory update to continue
            }

            // Delete the local file after processing
            fs.unlinkSync(filePath);

            res.status(201).json({ message: "Inventory updated successfully" });
          } catch (err) {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            res.status(500).json({ message: err.message });
          }
        });
    });

    writer.on("error", (err) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res
        .status(500)
        .json({ message: `Failed to write the file: ${err.message}` });
    });
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ message: error.message });
  }
});

module.exports = { bulkInventoryStock };
