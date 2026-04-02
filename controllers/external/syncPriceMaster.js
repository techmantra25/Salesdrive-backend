const asyncHandler = require("express-async-handler");
const { releaseLock, acquireLock } = require("../../models/lock.model");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const { SERVER_URL } = require("../../config/server.config");
const PriceCSV = require("../../models/priceCsv.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Region = require("../../models/region.model");

// --- Main Controller ---
const syncPriceMaster = asyncHandler(async (req, res) => {
  console.log("🔒 [syncPriceMaster] Attempting to acquire lock...");
  if (!(await acquireLock("syncPriceMaster"))) {
    console.error("⛔ [syncPriceMaster] Lock acquisition failed.");
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }
  console.log("✅ [syncPriceMaster] Lock acquired.");

  const startTime = Date.now();

  try {
    // --- Date Handling ---
    console.log("📅 [syncPriceMaster] Handling date range...");
    const { currentDate, previousDate } = getDateRange(req.query);
    console.log(
      `📅 [syncPriceMaster] Date range set: previousDate=${previousDate}, currentDate=${currentDate}`
    );

    // --- Data Load ---
    console.log("🌐 [syncPriceMaster] Loading data from SAP API...");
    const data = await loadDataFromApi({ currentDate, previousDate });
    // const data = await loadDataFromFile();

    if (!data.length) {
      console.warn(
        "⚠️ [syncPriceMaster] No data found for the given date range."
      );
      res.status(404);
      throw new Error("No data found for the given date range");
    }

    console.log(`📦 [syncPriceMaster] Loaded ${data.length} records from API.`);

    // --- Lookup Maps & Deduplication ---
    console.log("🗺️ [syncPriceMaster] Building lookup maps...");
    const vskuToInfo = buildVskuInfoMap(data);
    console.log("🧹 [syncPriceMaster] Deduplicating data by variant...");
    const uniqueData = deduplicateByKey(data, "variant");
    console.log(
      `🧮 [syncPriceMaster] Deduplicated data count: ${uniqueData.length}`
    );
    console.log("🔎 [syncPriceMaster] Fetching product IDs from DB...");
    const productCodeToId = await getProductIds(
      uniqueData.map((item) => item.variant)
    );
    console.log(
      `🆔 [syncPriceMaster] Product IDs fetched: ${productCodeToId.size}`
    );

    // --- Price Processing ---
    console.log("💸 [syncPriceMaster] Processing prices...");
    const priceData = processPrices(uniqueData);
    console.log(
      `💰 [syncPriceMaster] Price data processed: ${priceData.length} items`
    );

    // --- Final Price Build ---
    console.log("🏗️ [syncPriceMaster] Building final prices...");
    let finalPrices = await buildFinalPrices(
      priceData,
      vskuToInfo,
      productCodeToId
    );
    console.log(
      `🏁 [syncPriceMaster] Final prices built: ${finalPrices.length} items`
    );

    // --- Regional Prices ---
    console.log("🌏 [syncPriceMaster] Fetching regional prices...");
    const regionalPrices = await getRegionalPrices({
      previousDate,
    });
    console.log(
      `🌍 [syncPriceMaster] Regional prices fetched: ${regionalPrices.length} items`
    );

    finalPrices = [...finalPrices, ...regionalPrices];

    finalPrices = await getFinalPricesAfterNationalRegionalMerge(finalPrices);

    console.log(
      `🧮 [syncPriceMaster] Total final prices after regional merge: ${finalPrices.length}`
    );

    if (!finalPrices.length) {
      console.warn(
        "⚠️ [syncPriceMaster] No valid prices found after processing."
      );
      res.status(404);
      throw new Error("No valid prices found after processing");
    }

    // --- CSV Generation & Upload ---
    console.log("📝 [syncPriceMaster] Generating CSV...");
    const csvContent = generateCSV(finalPrices);
    console.log("☁️ [syncPriceMaster] Uploading CSV to cloud...");
    const uploadResult = await uploadCSV(csvContent, currentDate);
    console.log(
      `✅ [syncPriceMaster] CSV uploaded. Cloud URL: ${uploadResult.secure_url}`
    );

    // --- DB Save & Trigger Bulk Update ---
    console.log(
      "💾 [syncPriceMaster] Saving CSV record to DB and triggering bulk update..."
    );
    const [priceCSV] = await Promise.all([
      PriceCSV.create({
        url: { cronURL: uploadResult.secure_url, modifiedURL: null },
        status: "Pending",
      }),
      axios.put(`${SERVER_URL}/api/v1/price/bulk-update-status`, {}),
    ]);
    console.log(
      "✅ [syncPriceMaster] DB record created and bulk update triggered."
    );

    res.status(200).json({
      message: "Price master data synced and uploaded successfully",
      data: { urlData: uploadResult, priceCSV },
    });
    console.log(
      `🎉 [syncPriceMaster] Process completed successfully in ${
        (Date.now() - startTime) / 1000
      }s.`
    );
  } catch (err) {
    console.error("❌ [syncPriceMaster] Error:", err.message);
    res.status(res.statusCode === 200 ? 500 : res.statusCode);
    throw err;
  } finally {
    await releaseLock("syncPriceMaster");
    console.log("🔓 [syncPriceMaster] Lock released.");
  }
});

// --- Helper Functions ---

function getDateRange(query) {
  const formatDate = (d) => {
    const [y, m, day] = d.toISOString().split("T")[0].split("-");
    return `${day}.${m}.${y}`;
  };
  let currentDate = formatDate(new Date());
  let previousDate = formatDate(new Date());
  if (query.previousDate && query.currentDate) {
    if (new Date(query.previousDate) > new Date(query.currentDate)) {
      console.error(
        "⚠️ [getDateRange] Previous date is greater than current date."
      );
      throw new Error("Previous date cannot be greater than current date");
    }
    previousDate = query.previousDate;
    currentDate = query.currentDate;
  }
  return { currentDate, previousDate };
}

async function loadDataFromApi({ currentDate, previousDate }) {
  const url = `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_DMS_PRODUCT_MASTER_SRV/headerSet?sap-client=100&$filter=fromDate eq '${previousDate}' and toDate eq '${currentDate}' and variant eq ''&$format=json`;
  try {
    const response = await axios.get(url, {
      headers: { Cookie: "sap-usercontext=sap-client=100" },
    });
    return response.data?.d?.results || [];
  } catch (err) {
    console.error(
      "❌ [loadDataFromApi] Error fetching data from SAP API:",
      err.message
    );
    throw err;
  }
}

function loadDataFromFile() {
  try {
    const filePath = path.join(
      __dirname,
      "../../script/04_Scripts/01_Product_Master_Download/reports/unique_products_2025-08-04T09-31-15-286Z.json"
    );
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`);
  }
}

function buildVskuInfoMap(data) {
  const map = new Map();
  for (const item of data) {
    map.set(item.variant, {
      name: item.description || "",
      brand: item.brand || "",
      category: item.mat_grp || "",
    });
  }
  return map;
}

function deduplicateByKey(data, key) {
  const seen = new Set();
  const result = [];
  for (const item of data) {
    if (!seen.has(item[key])) {
      seen.add(item[key]);
      result.push(item);
    }
  }
  return result;
}

async function getProductIds(productCodes) {
  try {
    const products = await Product.find({
      product_code: { $in: productCodes },
    })
      .select("_id product_code")
      .lean();
    const map = new Map();
    for (const p of products) {
      map.set(p.product_code, p._id);
    }
    return map;
  } catch (err) {
    console.error(
      "❌ [getProductIds] Error fetching product IDs:",
      err.message
    );
    throw err;
  }
}

function processPrices(data) {
  return data.map((item) => ({
    product_code: item.variant,
    MRP: getMRP(item),
    DLP: getDLP(item),
  }));
}

getFinalPricesAfterNationalRegionalMerge = async (finalPrices) => {
  const regionalPrices = finalPrices.filter(
    (item) => item["Price Type"] === "regional"
  );
  const nationalPrices = finalPrices.filter(
    (item) => item["Price Type"] === "national"
  );

  console.log(
    `📊 [getFinalPricesAfterNationalRegionalMerge] Processing ${nationalPrices.length} national prices and ${regionalPrices.length} regional prices`
  );

  // Create a map of regional prices for quick lookup: product_code -> region_code -> regional_price_object
  const regionalPriceMap = new Map();
  regionalPrices.forEach((price) => {
    const productCode = price["Product Code"];
    const regionCode = price["Region Code"];

    if (!regionalPriceMap.has(productCode)) {
      regionalPriceMap.set(productCode, new Map());
    }
    regionalPriceMap.get(productCode).set(regionCode, price);
  });

  // Process each national price
  const updatedRegionalPrices = [...regionalPrices];
  const additionalRegionalPrices = [];

  for (const nationalPrice of nationalPrices) {
    const productCode = nationalPrice["Product Code"];
    const nationalMRP = nationalPrice.MRP;

    // Check if there are corresponding regional prices for this product
    const productRegionalPrices = regionalPriceMap.get(productCode);

    if (productRegionalPrices && productRegionalPrices.size > 0) {
      // 1. Update MRP of existing regional prices to match national MRP
      productRegionalPrices.forEach((regionalPrice, regionCode) => {
        const index = updatedRegionalPrices.findIndex(
          (rp) =>
            rp["Product Code"] === productCode &&
            rp["Region Code"] === regionCode
        );
        if (index !== -1) {
          updatedRegionalPrices[index].MRP = nationalMRP;
          console.log(
            `✅ [getFinalPricesAfterNationalRegionalMerge] Updated MRP for product ${productCode} in region ${regionCode} to ${nationalMRP}`
          );
        }
      });
    } else {
      // 2. No regional prices found in current data, check database for existing regional prices
      try {
        const existingRegionalPrices = await Price.find({
          productId: nationalPrice.product_id,
          price_type: "regional",
          status: true,
        })
          .populate("regionId", "code name")
          .lean();

        if (existingRegionalPrices && existingRegionalPrices.length > 0) {
          // Clone existing regional prices with updated MRP from national price
          for (const existingPrice of existingRegionalPrices) {
            const clonedRegionalPrice = {
              product_id: nationalPrice.product_id,
              "Product Code": nationalPrice["Product Code"],
              "Product Name": nationalPrice["Product Name"],
              "Product Brand": nationalPrice["Product Brand"],
              "Product Category": nationalPrice["Product Category"],
              "Effective Date": nationalPrice["Effective Date"],
              "Distributor Code": "",
              "Distributor Name": "",
              "Price Type": "regional",
              "Region Code": existingPrice.regionId?.code || "",
              region_id: existingPrice.regionId?._id || "",
              "Region Name": existingPrice.regionId?.name || "",
              MRP: nationalMRP, // Use national MRP
              DLP: existingPrice.dlp_price || "0.00",
              RLP: existingPrice.rlp_price || "0.00",
              "RLP Type": "old",
            };

            additionalRegionalPrices.push(clonedRegionalPrice);
            console.log(
              `🔄 [getFinalPricesAfterNationalRegionalMerge] Cloned regional price for product ${productCode} in region ${existingPrice.regionId?.code} with national MRP ${nationalMRP}`
            );
          }
        } else {
          console.log(
            `📝 [getFinalPricesAfterNationalRegionalMerge] No existing regional prices found for product ${productCode} in database`
          );
        }
      } catch (err) {
        console.error(
          `❌ [getFinalPricesAfterNationalRegionalMerge] Error fetching regional prices for product ${productCode}:`,
          err.message
        );
      }
    }
  }

  // Create final array with ALL national prices, updated regional prices, and additional regional prices from DB
  const finalMergedPrices = [
    ...nationalPrices, // Keep ALL national prices
    ...updatedRegionalPrices, // Updated regional prices
    ...additionalRegionalPrices, // Additional regional prices cloned from DB
  ];

  console.log(
    `🏁 [getFinalPricesAfterNationalRegionalMerge] Final merged prices: ${finalMergedPrices.length} (${nationalPrices.length} national + ${updatedRegionalPrices.length} regional + ${additionalRegionalPrices.length} additional regional)`
  );

  return finalMergedPrices;
};

// --- BATCHED getRegionalPrices ---
async function getRegionalPrices({ previousDate }) {
  let products_with_region_prices = [];

  // Fetch all regions and build lookup maps
  console.log("🌍 [getRegionalPrices] Fetching all regions...");
  const regions = await Region.find({}).populate("stateId", "").lean();

  if (!regions || !regions.length) {
    console.warn("⚠️ [getRegionalPrices] No regions found in the database.");
    return products_with_region_prices; // Return empty array if no regions
  }

  const stateCodeToRegion = new Map();
  const regionCodeToId = new Map();
  regions.forEach((r) => {
    regionCodeToId.set(r.code, r._id);
    stateCodeToRegion.set(r.stateId.code.padStart(2, "0"), {
      code: r.code,
      name: r.name,
    });
  });
  const getRegionByRegionCode = (regionCode) => {
    return (
      regions.find((r) => r.code === regionCode) || {
        _id: "",
        code: "",
        name: "",
      }
    );
  };

  console.log(
    `🌐 [getRegionalPrices] Regions loaded: ${regions.length}, stateCodeToRegion map size: ${stateCodeToRegion.size}`
  );

  // SAP API call (date is hardcoded for now, you may want to use currentDate)
  const regionResponse = await axios.get(
    `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_MAT_REG_PR1_SRV/HeaderSet(RegionCode='',Material='',FromDate='${previousDate}',ToDate='31.12.9999')/HeaderItem?$format=json`,
    { headers: { Cookie: "sap-usercontext=sap-client=100" } }
  );
  // const regionResponse = await axios.get(
  //   `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_MAT_REG_PR1_SRV/HeaderSet(RegionCode='',Material='',FromDate='01.08.2025',ToDate='31.12.9999')/HeaderItem?$format=json`,
  //   { headers: { Cookie: "sap-usercontext=sap-client=100" } }
  // );

  let rows = regionResponse.data?.d?.results || [];

  // take first 100 rows
  // rows = rows.slice(0, 1000);

  console.log(
    `🔍 [getRegionalPrices] Fetched ${rows.length} regional price records from SAP API `
  );

  // filter out the rows with unique Matnr and Regio combo
  const uniqueMatnr = new Set();
  const filteredRows = rows.filter((item) => {
    const key = `${item.Matnr}-${item.Regio}`;
    if (uniqueMatnr.has(key)) return false;
    uniqueMatnr.add(key);
    return true;
  });

  console.log(
    `🔎 [getRegionalPrices] Filtered to ${filteredRows.length} unique Matnr records`
  );

  // Batch DB calls for products
  let productCodes = filteredRows.map((item) => item.Matnr);
  productCodes = [...new Set(productCodes)];
  console.log(
    `📦 [getRegionalPrices] Unique product codes to process: ${productCodes.length}`
  );

  const products = await Product.find({
    product_code: { $in: productCodes },
  })
    .populate("brand", "")
    .populate("cat_id", "")
    .lean();
  const productMap = new Map();
  products.forEach((p) => productMap.set(p.product_code, p));

  for (const item of filteredRows) {
    const product_code = item.Matnr;
    const UOM = item?.Kmein || "PC";
    const product = productMap.get(product_code);
    let pcsInBox = Number(product?.no_of_pieces_in_a_box) || 1;

    if (UOM === "DZ") {
      pcsInBox = 12;
    } else if (UOM === "PC") {
      pcsInBox = 1;
    }

    const price = Math.max(0, Number((item.Kbetr || 0) / pcsInBox));
    const region = stateCodeToRegion.get(item.Regio) || {
      code: "",
      name: "",
    };

    if (
      !product_code ||
      !region.code ||
      isNaN(price) ||
      price <= 0 ||
      !product
    ) {
      console.warn(
        `⚠️ [getRegionalPrices] Skipping invalid record: product_code=${product_code}, region_code=${region.code}, price=${price}`
      );
      continue;
    }

    products_with_region_prices.push({
      product_code,
      product_name: product.name || "",
      product_brand: product.brand?.name || "",
      product_category: product.cat_id?.name || "",
      product_id: product._id,
      region_code: region.code,
      region_name: region.name,
      region_id: getRegionByRegionCode(region.code)._id,
      price: Number(price.toFixed(2)),
    });
  }

  console.log(
    `📊 [getRegionalPrices] Processed ${products_with_region_prices.length} regional price records`
  );

  // Now, build the final regional prices with DB lookups
  const finalRegionalPrices = [];
  for (let i = 0; i < products_with_region_prices.length; i++) {
    const item = products_with_region_prices[i];
    const product_id = item.product_id;
    const region_id = item.region_id;
    const effectiveDate = getTomorrowDateString();

    const basePrice = {
      product_id,
      "Product Code": item.product_code,
      "Product Name": item.product_name,
      "Product Brand": item.product_brand,
      "Product Category": item.product_category,
      "Effective Date": effectiveDate,
      "Distributor Code": "",
      "Distributor Name": "",
      "Price Type": "regional",
      "Region Code": item.region_code,
      region_id: region_id,
      "Region Name": item.region_name,
      MRP: "0.00",
      DLP: item?.price,
      RLP: item?.price,
      "RLP Type": "new",
    };

    try {
      const latestRegionalPrice = await Price.findOne({
        productId: product_id,
        regionId: region_id,
        price_type: "regional",
        status: true,
      });

      const latestNationalPrice = await Price.findOne({
        productId: product_id,
        price_type: "national",
        status: true,
      });

      if (!latestRegionalPrice && !latestNationalPrice) {
        finalRegionalPrices.push(basePrice);
      }

      if (latestRegionalPrice && !latestNationalPrice) {
        basePrice.MRP = latestRegionalPrice.mrp_price || "0.00";
        if (
          latestRegionalPrice?.rlp_price &&
          basePrice["Product Brand"] !== "MS"
        ) {
          basePrice.RLP = latestRegionalPrice.rlp_price || "0.00";
          basePrice["RLP Type"] = "old";
        }

        if (
          parseFloat(basePrice.MRP) !==
            parseFloat(latestRegionalPrice.mrp_price) ||
          parseFloat(basePrice.DLP) !==
            parseFloat(latestRegionalPrice.dlp_price) ||
          parseFloat(basePrice.RLP) !==
            parseFloat(latestRegionalPrice.rlp_price)
        ) {
          finalRegionalPrices.push(basePrice);
        }
      }

      if (!latestRegionalPrice && latestNationalPrice) {
        basePrice.MRP = latestNationalPrice.mrp_price || "0.00";
        if (
          latestNationalPrice?.rlp_price &&
          basePrice["Product Brand"] !== "MS"
        ) {
          basePrice.RLP = latestNationalPrice.rlp_price || "0.00";
        }

        finalRegionalPrices.push(basePrice);
      }

      if (latestRegionalPrice && latestNationalPrice) {
        basePrice.MRP = latestNationalPrice.mrp_price || "0.00";
        if (
          latestRegionalPrice?.rlp_price &&
          basePrice["Product Brand"] !== "MS"
        ) {
          basePrice.RLP = latestRegionalPrice.rlp_price || "0.00";
          basePrice["RLP Type"] = "old";
        }

        if (
          parseFloat(basePrice.MRP) !==
            parseFloat(latestRegionalPrice.mrp_price) ||
          parseFloat(basePrice.DLP) !==
            parseFloat(latestRegionalPrice.dlp_price) ||
          parseFloat(basePrice.RLP) !==
            parseFloat(latestRegionalPrice.rlp_price)
        ) {
          finalRegionalPrices.push(basePrice);
        }
      }
    } catch (err) {
      console.error(
        `❌ [getRegionalPrices] Error processing price for product_id=${product_id}, region_id=${region_id}:`,
        err.message
      );
    }

    if ((i + 1) % 1000 === 0) {
      console.log(
        `🔄 [getRegionalPrices] Processed ${i + 1} / ${
          products_with_region_prices.length
        } regional price records`
      );
    }
  }

  console.log(
    `🏁 [getRegionalPrices] Final regional prices count: ${finalRegionalPrices.length}`
  );

  return finalRegionalPrices;
}

async function buildFinalPrices(priceData, vskuToInfo, productCodeToId) {
  const effectiveDate = getTomorrowDateString();
  const finalPrices = [];

  for (const item of priceData) {
    const productInfo = vskuToInfo.get(item.product_code) || {};
    const product_id = productCodeToId.get(item.product_code);
    if (!product_id || !item.DLP || parseFloat(item.DLP) <= 0) continue;

    const basePrice = {
      product_id,
      "Product Code": item.product_code,
      "Product Name": productInfo.name,
      "Product Brand": productInfo.brand,
      "Product Category": productInfo.category,
      MRP: item.MRP,
      "Effective Date": effectiveDate,
      "Distributor Code": "",
      "Distributor Name": "",
      "Price Type": "national",
      "Region Code": "",
      region_id: "",
      "Region Name": "",
      DLP: item.DLP,
      RLP: item.DLP,
      "RLP Type": "new",
    };

    // Only this DB call is async
    let latestPrice;
    try {
      latestPrice = await Price.findOne({
        productId: product_id,
        price_type: "national",
        status: true,
      }).lean();
    } catch (err) {
      console.error(
        `❌ [buildFinalPrices] Error fetching latest price for product_id=${product_id}:`,
        err.message
      );
      continue;
    }

    if (latestPrice?.rlp_price && basePrice["Product Brand"] !== "MS") {
      basePrice.RLP = latestPrice.rlp_price;
      basePrice["RLP Type"] = "old";
    }

    if (latestPrice?.rlp_price && basePrice["Product Brand"] == "MS") {
      if (parseFloat(latestPrice?.rlp_price) == parseFloat(basePrice?.RLP)) {
        basePrice["RLP Type"] = "old";
      }
    }

    if (latestPrice) {
      if (
        parseFloat(latestPrice?.dlp_price) !== parseFloat(basePrice?.DLP) ||
        parseFloat(latestPrice?.mrp_price) !== parseFloat(basePrice?.MRP) ||
        basePrice["RLP Type"] === "new"
      ) {
        finalPrices.push(basePrice);
      }
    } else {
      finalPrices.push(basePrice);
    }
  }

  return finalPrices;
}

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

function generateCSV(finalPrices) {
  const csvHeader = [
    "Price Type",
    "Region Code",
    "Region Name",
    "Distributor Code",
    "Distributor Name",
    "Product Code",
    "Product Name",
    "Product Brand",
    "Product Category",
    "MRP",
    "DLP",
    "RLP",
    "Effective Date",
    "RLP Type",
  ];
  const escapeCsvValue = (value) =>
    value == null
      ? ""
      : /[",\n\r]/.test(String(value))
      ? `"${String(value).replace(/"/g, '""')}"`
      : String(value);
  return [
    csvHeader.join(","),
    ...finalPrices.map((row) =>
      csvHeader.map((field) => escapeCsvValue(row[field])).join(",")
    ),
  ].join("\n");
}

async function uploadCSV(csvContent, currentDate) {
  const uploadsDir = path.join(__dirname, "../../uploads");
  if (!fs.existsSync(uploadsDir)) {
    console.log("📁 [uploadCSV] Creating uploads directory...");
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const csvFileName = `price_master_${currentDate}.csv`;
  const csvFilePath = path.join(uploadsDir, csvFileName);
  fs.writeFileSync(csvFilePath, csvContent);
  console.log(`📝 [uploadCSV] CSV file written to ${csvFilePath}`);

  try {
    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(csvFilePath));
    formData.append("fileName", csvFileName);
    const result = await axios.post(
      `${SERVER_URL}/api/v1/cloudinary/upload`,
      formData,
      { headers: formData.getHeaders() }
    );
    console.log("☁️ [uploadCSV] CSV uploaded to cloudinary.");
    return result.data;
  } catch (err) {
    console.error("❌ [uploadCSV] Error uploading CSV:", err.message);
    throw err;
  } finally {
    try {
      fs.unlinkSync(csvFilePath);
      console.log("🗑️ [uploadCSV] Temporary CSV file deleted.");
    } catch (err) {
      console.warn("⚠️ [uploadCSV] Failed to delete temp file:", err.message);
    }
  }
}

// --- Price Calculation Utilities ---

function getUOM(item) {
  const su = item?.sales_unit?.trim();
  if (!su) return "pcs";
  if (su === "BOX") return "box";
  if (su === "DZ") return "dz";
  if (["1PA", "2PA", "3PA", "PAA", "PAK"].includes(su)) return su;
  return "pcs";
}

function getMRP(item) {
  let MRP = parseFloat(item.mrp || "0.00");
  let MRP_CONVERSION = item?.mrp_conv ? parseFloat(item.mrp_conv?.trim()) : 1;
  MRP = MRP / (MRP_CONVERSION > 0 ? MRP_CONVERSION : 1);
  MRP = isNaN(MRP) ? 0 : MRP;
  return MRP < 0 ? "0.00" : MRP.toFixed(2);
}

function getDLP(item) {
  let DLP = parseFloat(item.wsp || "0.00");
  let WSP_CONVERSION = item?.wsp_conv ? parseFloat(item.wsp_conv?.trim()) : 1;
  DLP = DLP / (WSP_CONVERSION > 0 ? WSP_CONVERSION : 1);
  DLP = isNaN(DLP) ? 0 : DLP;
  return DLP < 0 ? "0.00" : DLP.toFixed(2);
}

module.exports = { syncPriceMaster };
