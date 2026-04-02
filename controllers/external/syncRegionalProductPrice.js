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
const moment = require("moment-timezone");
const productRegionalPriceMaster = require("../../models/productRegionalPriceMaster.model");
const {writeLog} = require("../../writeLog");

// --- Main Controller ---
// const syncRegionalProductPrice = asyncHandler(async (req, res) => {
//   console.log("🔒 [syncRegionalProductPrice] Attempting to acquire lock...");
//   if (!(await acquireLock("syncRegionalProductPrice"))) {
//     console.error("⛔ [syncRegionalProductPrice] Lock acquisition failed.");
//     res.status(400);
//     throw new Error("Another sync is in progress. Please try again later.");
//   }
//   console.log("✅ [syncRegionalProductPrice] Lock acquired.");

//   const startTime = Date.now();

//   try {
//     // --- Date Handling ---
//     console.log("📅 [syncRegionalProductPrice] Handling date range...");
//     const previousDate  = req.query.previousDate;
//     const regionCode  = req.query.region;
//     const productCode  = req.query.product;
//     const formatDate = (d) => {
//     const [y, m, day] = d.toISOString().split("T")[0].split("-");
//     return `${day}.${m}.${y}`;
//   };
//   let currentDate = formatDate(new Date());
//     console.log(
//       `📅 [syncRegionalProductPrice] Date range set: previousDate=${previousDate}`
//     );

//     // regionCode filter
//     let RegionFilterObj;
//     if(regionCode){
//       console.log({
//           code: regionCode,
//           status: true,
//         });
//       RegionFilterObj = await Region.findOne({
//           code: regionCode,
//           status: true,
//         });
//         if (!RegionFilterObj) {
//           res.status(404);
//           throw new Error("No region found");
//         }
//     }
//     let ProductFilterObj;
//     if(productCode){
//       ProductFilterObj = await Product.findOne({
//           product_code: productCode,
//           status: true,
//         });
//         if (!ProductFilterObj) {
//           res.status(404);
//           throw new Error("No Product found");
//         }
//     }
//     // --- Data Load ---
//     console.log("🌐 [syncRegionalProductPrice] Loading data from SAP API...", previousDate);
//     const excludedProducts = await fetchProductCodesFromSAP({ previousDate });
//     if (!excludedProducts.length) {
//       console.warn(
//         "⚠️ [syncRegionalProductPrice] No products to exclude. Proceeding with all products."
//       );
//       res.status(404);
//       throw new Error("No data found for the given date range");
//     }
//     console.log(
//         `📋 [syncRegionalProductPrice] Excluding ${excludedProducts.length} products from update`
//       );
//     writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: Excluding ${excludedProducts.length} - ${new Date().toLocaleTimeString()}`);
//     const productsToUpdateQuery = {
//       product_code: { $nin: excludedProducts },
//       status: true,
//     };
//     if(ProductFilterObj){
//       console.log('productCode', productCode, ProductFilterObj.name);
//       productsToUpdateQuery.product_code = productCode;
//     }
//     if(RegionFilterObj){
//       const regionalPricesArr = await Price.find({
//         regionId: RegionFilterObj?._id,
//         price_type: "regional",
//         status: true,
//       });

//       // Extract product ids in array
//       const regionalProductIds = regionalPricesArr.map(p => p.productId.toString());
//       console.log('regionCode', regionCode, RegionFilterObj.name);
//       console.log('productsToUpdateQuery.productId', regionalPricesArr.length);
//       productsToUpdateQuery._id = { $in: regionalProductIds };
//     }

//     const productsToUpdate = await Product.find(productsToUpdateQuery).populate('brand','cat_id').select("_id product_code");
//     if (!productsToUpdate) {
//       console.log("ℹ️ No products found for update after exclusion");
//       return { processedCount: 0, updatedCount: 0 };
//     }

//     console.log(
//       `🎯 [syncRegionalProductPrice] Found ${productsToUpdate.length} products to potentially update`
//     );
//     writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: ${productsToUpdate.length} products to potentially update ${new Date().toLocaleTimeString()}`);

//         let updatedCount = 0;
//         let processedCount = 0;
//         let productsWithBothPrices = 0;
//         let updatedPrices = [];
    
//         // Step 3: For each product, check if it has both national and regional prices
//         for (const product of productsToUpdate) {
//           processedCount++;
    
//           try {
//             // Find national price for this product
//             const nationalPrice = await Price.findOne({
//               productId: product._id,
//               price_type: "national",
//               status: true,
//             });
    
//             // Find regional prices for this product
//             const regionalPriceQuery = {
//               productId: product._id,
//               price_type: "regional",
//               status: true,
//             };

//             // If region exists, add regionId filter
//             if (RegionFilterObj) {
//               regionalPriceQuery.regionId = RegionFilterObj._id;
//             }
//             const regionalPrices = await Price.find(regionalPriceQuery);
//             // const regionalPrices = await Price.find({
//             //   productId: product._id,
//             //   price_type: "regional",
//             //   status: true,
//             // });
    
//             const effectiveDate = getTomorrowDateString();
//             // If both national and regional prices exist, update regional DLP
//             if (nationalPrice && Array.isArray(regionalPrices) && regionalPrices.length > 0) {
//               productsWithBothPrices++;
//               console.log(`\n🔄 Processing product: ${product.product_code}`);
//               console.log(
//                 `🌍 Found ${regionalPrices.length} regional prices to update`
//               );
//               const latestUpdatePrices = await Price.find(
//                 {
//                   productId: product._id,
//                   price_type: "regional",
//                   status: true,
//                   dlp_price: { $ne : nationalPrice.dlp_price}
//                 }).populate([
//                 {
//                   path: "regionId",
//                   select: "",
//                 },
//                 {
//                   path: "distributorId",
//                   select: "",
//                 },
//               ]);
//               console.log(
//                 `🌍 Found ${latestUpdatePrices.length} regional prices need to updates.`
//               );
//               const formattedRows = latestUpdatePrices.map(doc => ({
//                 "Price Type" : doc.price_type,
//                 "Region Code" : doc.regionId?.code || "",
//                 "Region Name" : doc.regionId?.name || "",
//                 "Distributor Code": doc.distributorId?.dbCode || "",
//                 "Distributor Name": doc.regionId?.name || "",
//                 "Product Code" : product.product_code,
//                 "Product Name" : product.name,
//                 "Product Brand" : product.brand?.name || "",
//                 "Product Category" : product.cat_id?.name || "",
//                 "MRP" : doc.mrp_price,
//                 "DLP" : nationalPrice.dlp_price,
//                 "RLP" : doc.rlp_price,
//                 "Effective Date" : effectiveDate,
//                 "Skip Effective Date Check" : "1"
//                 // "RLP Type" : 'new',
//               }));
//               updatedCount += latestUpdatePrices.length;
//               updatedPrices.push(...formattedRows);
//               // if (updatedPrices.length > 0) {
//               //   const csvContent = generateCSV(formattedRows);
//               //   console.log("☁️ [syncRegionalProductPrice] Uploading CSV to cloud...");
//               //   const uploadResult = await uploadCSV(csvContent, currentDate);
//               //   console.log('uploadResult', uploadResult);
//               //   return false;
//               // }
//             } else if (!nationalPrice && Array.isArray(regionalPrices) && regionalPrices.length > 0) {
//               console.log(
//                 `⚠️ Product ${product.product_code} has regional prices but no national price`
//               );
//             } else if (nationalPrice && Array.isArray(regionalPrices) && regionalPrices.length === 0) {
//               console.log(
//                 `ℹ️ Product ${product.product_code} has national price but no regional prices`
//               );
//             }
//           } catch (productError) {
//             console.error(
//               `❌ Error processing product ${product.product_code}:`,
//               productError.message
//             );
//             continue;
//           }
    
//           // Progress indicator
//           if (processedCount % 1000 === 0) {
//             writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: Progress: ${processedCount}/${productsToUpdate.length} products processed ${new Date().toLocaleTimeString()}`);
//             console.log(
//               `\n📈 Progress: ${processedCount}/${productsToUpdate.length} products processed`
//             );
//           }
//         }
    
//         const result = {
//           excludedProductsCount: excludedProducts.length,
//           processedCount,
//           productsWithBothPrices,
//           updatedCount,
//         };
    
//         console.log(`\n🎉 === Update Complete ===`);
//         console.log(
//           `📋 Products excluded from SAP: ${result.excludedProductsCount}`
//         );
//         console.log(`🔍 Total products processed: ${result.processedCount}`);
//         console.log(
//           `🎯 Products with both price types: ${result.productsWithBothPrices}`
//         );
//         console.log(`✅ Total regional prices updated: ${result.updatedCount}`);
//         // --- CSV Generation & Upload ---
//         console.log("📝 [syncRegionalProductPrice] Generating CSV...");
//         const csvContent = generateCSV(updatedPrices);
//         console.log("☁️ [syncRegionalProductPrice] Uploading CSV to cloud...");
//         const uploadResult = await uploadCSV(csvContent, currentDate);
//         console.log(
//           `✅ [syncRegionalProductPrice] CSV uploaded. Cloud URL: ${uploadResult.secure_url}`
//         );
//         console.log("💾 [syncRegionalProductPrice] Saving CSV record.");
//         await PriceCSV.create({
//           url: { cronURL: uploadResult.secure_url, modifiedURL: null },
//           status: "Pending",
//         });
//         console.log("✅ [syncRegionalProductPrice] DB CSV record created.");
//         // return result;
//             return res.status(200).json({
//             status: 200,
//             message: "Updated",
//             data: {
//               'file':uploadResult.secure_url,
//               'result':result
//             },
//         });
//   } catch (err) {
//     console.error("❌ [syncRegionalProductPrice] Error:", err.message);
//     res.status(res.statusCode === 200 ? 500 : res.statusCode);
//     throw err;
//   } finally {
//     await releaseLock("syncRegionalProductPrice");
//     console.log("🔓 [syncRegionalProductPrice] Lock released.");
//   }
// });
const syncRegionalProductPrice = asyncHandler(async (req, res) => {
  console.log("🔒 [syncRegionalProductPrice] Attempting to acquire lock...");
  if (!(await acquireLock("syncRegionalProductPrice"))) {
    console.error("⛔ [syncRegionalProductPrice] Lock acquisition failed.");
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }
  console.log("✅ [syncRegionalProductPrice] Lock acquired.");

  const startTime = Date.now();

  // helper to format dd.mm.yyyy
  const formatDate = (d) => {
    const [y, m, day] = d.toISOString().split("T")[0].split("-");
    return `${day}.${m}.${y}`;
  };

  try {
    // --- Date Handling ---
    console.log("📅 [syncRegionalProductPrice] Handling date range...");
    const previousDate = req.query.previousDate;
    const regionCode = req.query.region;
    const productCode = req.query.product;

    const currentDate = formatDate(new Date());
    console.log(
      `📅 [syncRegionalProductPrice] Date range set: previousDate=${previousDate}`
    );

    // regionCode filter
    let RegionFilterObj = null;
    if (regionCode) {
      console.log({ code: regionCode, status: true });
      RegionFilterObj = await Region.findOne({ code: regionCode, status: true });
      if (!RegionFilterObj) {
        res.status(404);
        throw new Error("No region found");
      }
    }

    let ProductFilterObj = null;
    if (productCode) {
      ProductFilterObj = await Product.findOne({
        product_code: productCode,
        status: true,
      });
      if (!ProductFilterObj) {
        res.status(404);
        throw new Error("No Product found");
      }
    }

    // --- Data Load: fetch excluded products from SAP ---
    console.log("🌐 [syncRegionalProductPrice] Loading data from SAP API...", previousDate);
    const excludedProducts = await fetchProductCodesFromSAP({ previousDate });
    if (!excludedProducts || !excludedProducts.length) {
      console.warn(
        "⚠️ [syncRegionalProductPrice] No products to exclude. Proceeding with all products."
      );
      res.status(404);
      throw new Error("No data found for the given date range");
    }
    console.log(`📋 [syncRegionalProductPrice] Excluding ${excludedProducts.length} products from update`);
    writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: Excluding ${excludedProducts.length} - ${new Date().toLocaleTimeString()}`);

    // Build product query
    const productsToUpdateQuery = {
      product_code: { $nin: excludedProducts },
      status: true,
    };
    if (ProductFilterObj) {
      productsToUpdateQuery.product_code = productCode;
    }

    // If region specified, we only want products that exist for that region (by Price docs)
    if (RegionFilterObj) {
      // find prices for region and gather productIds (one query)
      const regionalPricesForRegion = await Price.find({
        regionId: RegionFilterObj._id,
        price_type: "regional",
        status: true,
      }).select("productId");

      const regionalProductIds = regionalPricesForRegion.map((p) =>
        p.productId.toString()
      );

      // limit products to these productIds
      productsToUpdateQuery._id = { $in: regionalProductIds };
    }

    // Load products to update (1 query)
    const productsToUpdate = await Product.find(productsToUpdateQuery)
    .populate("brand", "cat_id")
    .select("_id product_code name brand cat_id");
    
    if (!productsToUpdate || productsToUpdate.length === 0) {
      console.log("ℹ️ No products found for update after exclusion");
      return res.status(200).json({
        status: 200,
        message: "No products to process",
        data: { processedCount: 0, updatedCount: 0 },
      });
    }

    console.log(`🎯 [syncRegionalProductPrice] Found ${productsToUpdate.length} products to potentially update`);

    // Collect productIds
    const productIds = productsToUpdate.map((p) => p._id);

    // --- BULK LOAD PRICES ---
    // 1) Load national prices for these products (1 query)
    const nationalPrices = await Price.find({
      productId: { $in: productIds },
      price_type: "national",
      status: true,
    }).select("productId dlp_price");

    const nationalMap = new Map(); // productId -> nationalPriceDoc
    for (const np of nationalPrices) {
      nationalMap.set(np.productId.toString(), np);
    }

    // 2) Load regional prices for these products (1 query). Populate region/distributor for CSV.
    const regionalQuery = {
      productId: { $in: productIds },
      price_type: "regional",
      status: true,
    };
    if (RegionFilterObj) regionalQuery.regionId = RegionFilterObj._id;

    const regionalPricesAll = await Price.find(regionalQuery).populate([
      { path: "regionId", select: "code name" },
      { path: "distributorId", select: "dbCode name" },
    ]);

    // Group regional prices by productId (in-memory)
    const regionalMap = new Map(); // productId -> [regionalPriceDoc,...]
    for (const rp of regionalPricesAll) {
      const key = rp.productId.toString();
      if (!regionalMap.has(key)) regionalMap.set(key, []);
      regionalMap.get(key).push(rp);
    }

    // --- In-memory processing (NO DB queries inside loop) ---
    let updatedCount = 0;
    let processedCount = 0;
    let productsWithBothPrices = 0;
    const updatedPrices = [];

    const effectiveDate = getTomorrowDateString();

    for (const product of productsToUpdate) {
      processedCount++;
      const pid = product._id.toString();
      const national = nationalMap.get(pid);
      const regionals = regionalMap.get(pid) || [];

      if (national && regionals.length > 0) {
        productsWithBothPrices++;
        // Filter regional docs that need updating (dlp differs)
        const needUpdate = regionals.filter((r) => r.dlp_price !== national.dlp_price);
        if (needUpdate.length > 0) {
          console.log(`\n🔄 Processing product: ${product.product_code} — need ${needUpdate.length} regional updates`);
        }
        updatedCount += needUpdate.length;

        for (const doc of needUpdate) {
          updatedPrices.push({
            "Price Type": doc.price_type,
            "Region Code": doc.regionId?.code || "",
            "Region Name": doc.regionId?.name || "",
            "Distributor Code": doc.distributorId?.dbCode || "",
            "Distributor Name": doc.distributorId?.name || "",
            "Product Code": product.product_code,
            "Product Name": product.name,
            "Product Brand": product.brand?.name || "",
            "Product Category": product.cat_id?.name || "",
            "MRP": doc.mrp_price,
            "DLP": national.dlp_price,
            "RLP": doc.rlp_price,
            "Effective Date": effectiveDate,
            "Skip Effective Date Check": "1",
          });
        }
      } else if (!national && regionals.length > 0) {
        console.log(`⚠️ Product ${product.product_code} has regional prices but no national price`);
      } else if (national && regionals.length === 0) {
        console.log(`ℹ️ Product ${product.product_code} has national price but no regional prices`);
      }

      // Optional progress log for every 1000 items
      if (processedCount % 1000 === 0) {
        writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: Progress: ${processedCount}/${productsToUpdate.length} products processed ${new Date().toLocaleTimeString()}`);
        console.log(`\n📈 Progress: ${processedCount}/${productsToUpdate.length} products processed`);
      }
    }

    const result = {
      excludedProductsCount: excludedProducts.length,
      processedCount,
      productsWithBothPrices,
      updatedCount,
    };

    console.log(`\n🎉 === Update Complete ===`);
    console.log(`📋 Products excluded from SAP: ${result.excludedProductsCount}`);
    console.log(`🔍 Total products processed: ${result.processedCount}`);
    console.log(`🎯 Products with both price types: ${result.productsWithBothPrices}`);
    console.log(`✅ Total regional prices updated: ${result.updatedCount}`);

    // --- CSV Generation & Upload (same behavior as before) ---
    console.log("📝 [syncRegionalProductPrice] Generating CSV...");
    const csvContent = generateCSV(updatedPrices); // reuse your existing function
    console.log("☁️ [syncRegionalProductPrice] Uploading CSV to cloud...");
    const uploadResult = await uploadCSV(csvContent, currentDate);
    console.log(`✅ [syncRegionalProductPrice] CSV uploaded. Cloud URL: ${uploadResult.secure_url}`);

    console.log("💾 [syncRegionalProductPrice] Saving CSV record.");
    writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: CSV Uploaded - ${new Date().toLocaleTimeString()}`);
    await PriceCSV.create({
      url: { cronURL: uploadResult.secure_url, modifiedURL: null },
      status: "Pending",
    });
    console.log("✅ [syncRegionalProductPrice] DB CSV record created.");

    return res.status(200).json({
      status: 200,
      message: "Updated",
      data: {
        file: uploadResult.secure_url,
        result,
      },
    });
  } catch (err) {
    console.error("❌ [syncRegionalProductPrice] Error:", err.message || err);
    res.status(res.statusCode === 200 ? 500 : res.statusCode);
    throw err;
  } finally {
    await releaseLock("syncRegionalProductPrice");
    console.log("🔓 [syncRegionalProductPrice] Lock released.");
    const durationMs = Date.now() - startTime;
    writeLog(`SYNC_REGIONAL_PRODUCT_PRICE: Duration ${durationMs} ms - ${new Date().toLocaleTimeString()}`);
    console.log(`⏱ [syncRegionalProductPrice] Duration: ${durationMs} ms`);
  }
});

// --- Helper Functions ---

// --- BATCHED getRegionalPrices ---
async function fetchProductCodesFromSAP({ previousDate }) {
  // SAP API call (date is hardcoded for now, you may want to use currentDate)
  const regionResponse = await axios.get(
    `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_MAT_REG_PR1_SRV/HeaderSet(RegionCode='',Material='',FromDate='${previousDate}',ToDate='31.12.9999')/HeaderItem?$format=json`,
    { headers: { Cookie: "sap-usercontext=sap-client=100" } }
  );

  let rows = regionResponse.data?.d?.results || [];

  console.log(
    `🔍 [fetchProductCodesFromSAP] Fetched ${rows.length} regional price records from SAP API `
  );

  if (!rows.length) {
    console.warn(
      "⚠️ [fetchProductCodesFromSAP] No data found for the given date range."
    );
    throw new Error("No data found for the given date range");
  }

  const productRegionalPriceMasterData = rows.map((item) => ({
      Matnr: item.Matnr,
      Maktx: item.Maktx,
      Regio: item.Regio,
      Bezei: item.Bezei,
      FromDate: item.FromDate ? new Date(parseInt(item.FromDate.match(/\d+/)[0])) : null,
      ToDate: item.ToDate ? new Date(parseInt(item.ToDate.match(/\d+/)[0])) : null,
      Kbetr: parseFloat(item.Kbetr),
      Konwa: item.Konwa,
      Kpein: parseFloat(item.Kpein),
      Kmein: item.Kmein,
    }));
    await productRegionalPriceMaster.deleteMany({});
    await productRegionalPriceMaster.insertMany(productRegionalPriceMasterData, { ordered: false });
    console.log("🌐 [productRegionalPriceMaster] Inserted ...", productRegionalPriceMasterData.length);

  // filter out the rows with unique Matnr and Regio combo
  const uniqueMatnr = new Set();
  const filteredRows = rows.filter((item) => {
    const key = `${item.Matnr}`;
    if (uniqueMatnr.has(key)) return false;
    uniqueMatnr.add(key);
    return true;
  });

  console.log(
    `🔎 [fetchProductCodesFromSAP] Filtered to ${filteredRows.length} unique Matnr records`
  );

  // Batch DB calls for products
  let productCodes = filteredRows.map((item) => item.Matnr);
  productCodes = [...new Set(productCodes)];
  console.log(
    `📦 [fetchProductCodesFromSAP] Unique product codes to process: ${productCodes.length}`
  );

  return productCodes;
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
    "Skip Effective Date Check",
    // "RLP Type",
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
  const csvFileName = `dlp_price_update_master_${currentDate}.csv`;
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

module.exports = { syncRegionalProductPrice };
