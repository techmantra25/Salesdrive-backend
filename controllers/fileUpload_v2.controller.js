const asyncHandler = require("express-async-handler");
const Product = require("../models/product.model");
const Price = require("../models/price.model");
const csv = require("csv-parser");
const axios = require("axios");
const moment = require("moment-timezone");
const { SERVER_URL } = require("../config/server.config");

const saveCsvToDB_v2 = asyncHandler(async (req, res) => {
  try {
    const results = [];
    const fileUrl = req.body.file;

    // Extract file extension using regex
    const fileMime = fileUrl.match(/\.([^.?]+)(?:\?|$)/)?.[1]?.toLowerCase();

    if (fileMime !== "csv") {
      return res
        .status(400)
        .send({ error: true, message: "Only CSV file is allowed." });
    }

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
    });

    response.data
      .pipe(csv())
      .on("data", (data) => {
        results.push(data);
      })
      .on("end", async () => {
        try {
          let resp = [];
          let skippedRows = [];

          switch (req.params.csvType) {
            case "InactivePriceByPriceCode": {
              // CSV structure:
              // Price Code, Expiry
              //  Task: Find the price by code and set expiry date (at the end of the day 11:59 PM asia kolkata time zone) Expiry will be in DD-MM-YYYY format in the csv
              // If the price code is not found or already expired, or if the expiry date is not valid, skip that row and add to skippedRows with reason
              // at the start of the implementation and end of the implementation, call this function bulkUpdateStatus
              async function bulkUpdateStatus() {
                await axios.put(
                  `${SERVER_URL}/api/v1/price/bulk-update-status`,
                  {},
                  {
                    headers: {
                      "Content-Type": "application/json",
                    },
                  }
                );
              }

              console.log("Processing InactivePriceByPriceCode CSV");

              // Call bulk update status at the start
              try {
                await bulkUpdateStatus();
                console.log("Initial bulk update status completed");
              } catch (error) {
                console.warn(
                  "Initial bulk update status failed:",
                  error.message
                );
              }

              const skippedRowsForPriceCode = [];
              const updatedPrices = [];

              // 1. Collect unique price codes for batch query
              const priceCodes = new Set();
              for (const row of results) {
                if (row["Price Code"]) {
                  priceCodes.add(row["Price Code"].trim());
                }
              }

              // 2. Fetch all prices by codes in one query
              const existingPrices = await Price.find({
                code: { $in: Array.from(priceCodes) },
                status: true,
              }).lean();

              // 3. Create lookup map for quick access
              const priceMap = new Map(
                existingPrices.map((p) => [p.code.trim(), p])
              );

              // 4. Process each row
              for (const row of results) {
                const priceCode = row["Price Code"]?.trim();
                const expiry = row["Expiry"]?.trim();

                // Basic validation
                if (!priceCode || !expiry) {
                  skippedRowsForPriceCode.push({
                    ...row,
                    reason: "Missing required fields (Price Code, Expiry)",
                  });
                  continue;
                }

                // Check if price exists
                const existingPrice = priceMap.get(priceCode);
                if (!existingPrice) {
                  skippedRowsForPriceCode.push({
                    ...row,
                    reason: "Price code not found",
                  });
                  continue;
                }

                // Check if price is already expired
                if (
                  existingPrice.expiresAt &&
                  new Date() > new Date(existingPrice.expiresAt)
                ) {
                  skippedRowsForPriceCode.push({
                    ...row,
                    reason: "Price is already expired",
                  });
                  continue;
                }

                // Validate expiry date format (DD-MM-YYYY)
                const parsedExpiryDate = moment(expiry, "DD-MM-YYYY");
                if (!parsedExpiryDate.isValid()) {
                  skippedRowsForPriceCode.push({
                    ...row,
                    reason: "Invalid expiry date format (expected DD-MM-YYYY)",
                  });
                  continue;
                }

                // Set expiry to end of day (11:59 PM) in Asia/Kolkata timezone
                const expiryDate = moment
                  .tz(
                    parsedExpiryDate.format("YYYY-MM-DD"),
                    "YYYY-MM-DD",
                    "Asia/Kolkata"
                  )
                  .endOf("day")
                  .toDate();

                // Update the price with expiry date
                await Price.findByIdAndUpdate(
                  existingPrice._id,
                  { expiresAt: expiryDate },
                  { new: true }
                );

                updatedPrices.push({
                  priceCode: priceCode,
                  expiresAt: expiryDate,
                  _id: existingPrice._id,
                });
              }

              console.log(
                `Updated ${updatedPrices.length} prices with expiry dates`
              );
              console.log(`Skipped ${skippedRowsForPriceCode.length} rows`);

              // Call bulk update status at the end
              try {
                await bulkUpdateStatus();
                console.log("Final bulk update status completed");
              } catch (error) {
                console.warn("Final bulk update status failed:", error.message);
              }

              resp = updatedPrices;
              skippedRows = skippedRowsForPriceCode;

              break;
            }

            case "InactivePriceByProductCodeAndPriceType": {
              // CSV structure:
              // Product Code, Price Type, Expiry
              // Task: Find the prices by product code and price type, and set expiry date (at the end of the day 11:59 PM asia kolkata time zone) Expiry will be in DD-MM-YYYY format in the csv
              // If the product code is not found or already expired, or if the expiry date is not valid, skip that row and add to skippedRows with reason
              // at the start of the implementation and end of the implementation, call this function bulkUpdateStatus
              async function bulkUpdateStatusForProductCode() {
                await axios.put(
                  `${SERVER_URL}/api/v1/price/bulk-update-status`,
                  {},
                  {
                    headers: {
                      "Content-Type": "application/json",
                    },
                  }
                );
              }

              console.log(
                "Processing InactivePriceByProductCodeAndPriceType CSV"
              );

              // Call bulk update status at the start
              try {
                await bulkUpdateStatusForProductCode();
                console.log("Initial bulk update status completed");
              } catch (error) {
                console.warn(
                  "Initial bulk update status failed:",
                  error.message
                );
              }

              const skippedRowsForProductCode = [];
              const updatedPricesForProductCode = [];

              // 1. Collect unique product codes for batch query
              const productCodes = new Set();
              for (const row of results) {
                if (row["Product Code"]) {
                  productCodes.add(row["Product Code"].trim());
                }
              }

              // 2. Fetch all products by codes in one query
              const existingProducts = await Product.find({
                product_code: { $in: Array.from(productCodes) },
              })
                .select("product_code _id")
                .lean();

              // 3. Create lookup map for quick access
              const productMap = new Map(
                existingProducts.map((p) => [p.product_code.trim(), p._id])
              );

              // 4. Process each row
              for (const row of results) {
                const productCode = row["Product Code"]?.trim();
                const priceType = row["Price Type"]?.trim()?.toLowerCase();
                const expiry = row["Expiry"]?.trim();

                // Basic validation
                if (!productCode || !priceType || !expiry) {
                  skippedRowsForProductCode.push({
                    ...row,
                    reason:
                      "Missing required fields (Product Code, Price Type, Expiry)",
                  });
                  continue;
                }

                // Validate price type
                const validPriceTypes = ["regional", "distributor", "national"];
                if (!validPriceTypes.includes(priceType)) {
                  skippedRowsForProductCode.push({
                    ...row,
                    reason: `Invalid price type. Allowed values: ${validPriceTypes.join(
                      ", "
                    )}`,
                  });
                  continue;
                }

                // Check if product exists
                const productId = productMap.get(productCode);
                if (!productId) {
                  skippedRowsForProductCode.push({
                    ...row,
                    reason: "Product code not found",
                  });
                  continue;
                }

                // Validate expiry date format (DD-MM-YYYY)
                const parsedExpiryDate = moment(expiry, "DD-MM-YYYY");
                if (!parsedExpiryDate.isValid()) {
                  skippedRowsForProductCode.push({
                    ...row,
                    reason: "Invalid expiry date format (expected DD-MM-YYYY)",
                  });
                  continue;
                }

                // Set expiry to end of day (11:59 PM) in Asia/Kolkata timezone
                const expiryDate = moment
                  .tz(
                    parsedExpiryDate.format("YYYY-MM-DD"),
                    "YYYY-MM-DD",
                    "Asia/Kolkata"
                  )
                  .endOf("day")
                  .toDate();

                // Find prices by product code and price type that are active
                const existingPrices = await Price.find({
                  productId: productId,
                  price_type: priceType,
                  status: true,
                  $or: [
                    { expiresAt: null },
                    { expiresAt: { $gt: new Date() } },
                  ],
                }).lean();

                if (existingPrices.length === 0) {
                  skippedRowsForProductCode.push({
                    ...row,
                    reason:
                      "No active prices found for this product code and price type",
                  });
                  continue;
                }

                // Update all matching prices with expiry date
                const priceIds = existingPrices.map((p) => p._id);
                await Price.updateMany(
                  { _id: { $in: priceIds } },
                  { expiresAt: expiryDate }
                );

                updatedPricesForProductCode.push({
                  productCode: productCode,
                  priceType: priceType,
                  expiresAt: expiryDate,
                  updatedCount: priceIds.length,
                  priceIds: priceIds,
                });
              }

              console.log(
                `Updated ${updatedPricesForProductCode.reduce(
                  (sum, item) => sum + item.updatedCount,
                  0
                )} prices with expiry dates`
              );
              console.log(`Skipped ${skippedRowsForProductCode.length} rows`);

              // Call bulk update status at the end
              try {
                await bulkUpdateStatusForProductCode();
                console.log("Final bulk update status completed");
              } catch (error) {
                console.warn("Final bulk update status failed:", error.message);
              }

              resp = updatedPricesForProductCode;
              skippedRows = skippedRowsForProductCode;

              break;
            }

            default: {
              return res
                .status(400)
                .send({ error: true, message: "Invalid CSV type" });
            }
          }

          return res.status(200).send({
            error: false,
            message: "Data saved successfully",
            data: resp,
            skippedRows: skippedRows,
          });
        } catch (error) {
          console.error("Error during data processing:", error);
          return res.status(500).send({
            error: true,
            message: "Internal Server Error",
            error: error.message,
          });
        }
      })
      .on("error", (error) => {
        console.error("Error reading file:", error);
        return res.status(500).send({
          error: true,
          message: "Failed to read file",
          error,
        });
      });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { saveCsvToDB_v2 };
