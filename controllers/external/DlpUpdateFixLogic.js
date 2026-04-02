const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

const fetchProductCodesFromSAP = asyncHandler(async (req, res) => {
  try {
    console.log(`🔄 [fetchProductCodesFromSAP] Fetching data from SAP API`);

    // SAP API call
    const regionResponse = await axios.get(
      `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_MAT_REG_PR1_SRV/HeaderSet(RegionCode='',Material='',FromDate='01.01.2019',ToDate='31.12.9999')/HeaderItem?$format=json`,
      {
        headers: { Cookie: "sap-usercontext=sap-client=100" },
        timeout: 30000, // Add timeout for safety
      }
    );

    let rows = regionResponse.data?.d?.results || [];
    console.log(
      `🔍 [fetchProductCodesFromSAP] Fetched ${rows.length} regional price records from SAP API`
    );

    if (rows.length === 0) {
      console.log(
        "⚠️ [fetchProductCodesFromSAP] No data returned from SAP API"
      );
      return [];
    }

    // Filter out the rows with unique Matnr and Regio combo
    const uniqueMatnr = new Set();
    const filteredRows = rows.filter((item) => {
      const key = `${item.Matnr}-${item.Regio}`;
      if (uniqueMatnr.has(key)) return false;
      uniqueMatnr.add(key);
      return true;
    });

    console.log(
      `🔎 [fetchProductCodesFromSAP] Filtered to ${filteredRows.length} unique Matnr-Region records`
    );

    // Extract unique product codes
    let productCodes = filteredRows.map((item) => item.Matnr);
    productCodes = [...new Set(productCodes)];

    // Filter out null, undefined, or empty strings
    productCodes = productCodes.filter((code) => code && code.trim() !== "");

    console.log(
      `📦 [fetchProductCodesFromSAP] Unique product codes to exclude: ${productCodes.length}`
    );

    return productCodes;
  } catch (error) {
    console.error(
      "❌ [fetchProductCodesFromSAP] Error fetching product codes from SAP:",
      error.message
    );
    throw error;
  }
});
function getTomorrowDateString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow
    .toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .split("/")
    .join("-");
}

const updateRegionalDLPPricesWithSAPData = asyncHandler(async (req, res) => {
  try {
    // Step 1: Fetch product codes from SAP API to exclude
    const excludedProducts = await fetchProductCodesFromSAP();

    if (excludedProducts.length === 0) {
      console.log("⚠️ No products to exclude. Proceeding with all products.");
    } else {
      console.log(
        `📋 Excluding ${excludedProducts.length} products from update`
      );
    }

    // Step 2: Get all products that are NOT in the excluded list
    const productsToUpdate = await Product.find({
      product_code: { $nin: excludedProducts },
      status: true,
    }).select("_id product_code");

    console.log(
      `🎯 Found ${productsToUpdate.length} products to potentially update`
    );

    if (productsToUpdate.length === 0) {
      console.log("ℹ️ No products found for update after exclusion");
      return { processedCount: 0, updatedCount: 0 };
    }

    let updatedCount = 0;
    let processedCount = 0;
    let productsWithBothPrices = 0;

    // Step 3: For each product, check if it has both national and regional prices
    for (const product of productsToUpdate) {
      processedCount++;

      try {
        // Find national price for this product
        const nationalPrice = await Price.findOne({
          productId: product._id,
          price_type: "national",
          status: true,
        });

        // Find regional prices for this product
        const regionalPrices = await Price.find({
          productId: product._id,
          price_type: "regional",
          status: true,
        });

        const effectiveDate = getTomorrowDateString();

        // If both national and regional prices exist, update regional DLP
        if (nationalPrice && regionalPrices.length > 0) {
          productsWithBothPrices++;
          console.log(`\n🔄 Processing product: ${product.product_code}`);
          console.log(`📊 National Price: ${nationalPrice}`);
          console.log(
            `🌍 Found ${regionalPrices.length} regional prices to update`
          );

          // Update all regional prices with national DLP price
          const updateResult = await Price.updateMany(
            {
              productId: product._id,
              price_type: "regional",
              status: true,
            },
            {
              $set: {
                dlp_price: nationalPrice.dlp_price,
                effective_date: effectiveDate,
                updatedAt: new Date(),
              },
            }
          );

          updatedCount += updateResult.modifiedCount;
          console.log(
            `✅ Updated ${updateResult.modifiedCount} regional prices of Product ${product.product_code}`
          );
        } else if (!nationalPrice && regionalPrices.length > 0) {
          console.log(
            `⚠️ Product ${product.product_code} has regional prices but no national price`
          );
        } else if (nationalPrice && regionalPrices.length === 0) {
          console.log(
            `ℹ️ Product ${product.product_code} has national price but no regional prices`
          );
        }
      } catch (productError) {
        console.error(
          `❌ Error processing product ${product.product_code}:`,
          productError.message
        );
        continue;
      }

      // Progress indicator
      if (processedCount % 50 === 0) {
        console.log(
          `\n📈 Progress: ${processedCount}/${productsToUpdate.length} products processed`
        );
      }
    }

    const result = {
      excludedProductsCount: excludedProducts.length,
      processedCount,
      productsWithBothPrices,
      updatedCount,
    };

    console.log(`\n🎉 === Update Complete ===`);
    console.log(
      `📋 Products excluded from SAP: ${result.excludedProductsCount}`
    );
    console.log(`🔍 Total products processed: ${result.processedCount}`);
    console.log(
      `🎯 Products with both price types: ${result.productsWithBothPrices}`
    );
    console.log(`✅ Total regional prices updated: ${result.updatedCount}`);

    return result;
  } catch (error) {
    console.error("❌ Error updating regional DLP prices:", error);
    throw error;
  }
});

// Export the functions
module.exports = {
  fetchProductCodesFromSAP,
  updateRegionalDLPPricesWithSAPData,
};
