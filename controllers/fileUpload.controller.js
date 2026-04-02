const asyncHandler = require("express-async-handler");
const Category = require("../models/category.model");
const Brand = require("../models/brand.model");
const Collection = require("../models/collection.model");
const Product = require("../models/product.model");
const Region = require("../models/region.model");
const State = require("../models/state.model");
const Zone = require("../models/zone.model");
const User = require("../models/user.model");
const Price = require("../models/price.model");
const SubBrand = require("../models/subBrand.model");
const Supplier = require("../models/supplier.model");
const Counter = require("../models/counter.model");
const csv = require("csv-parser");
const axios = require("axios");
const { generateCode } = require("../utils/codeGenerator");
const moment = require("moment-timezone");
const Distributor = require("../models/distributor.model");
const Outlet = require("../models/outlet.model");
const Employee = require("../models/employee.model");
const Beat = require("../models/beat.model");
const District = require("../models/district.model");
const Designation = require("../models/designation.model");
const EmployeeMapping = require("../models/employeeMapping.model");
const EmployeePassword = require("../models/employeePassword.model");
const OutletApproved = require("../models/outletApproved.model");
const DbBank = require("../models/dbBank.model");
const Password = require("../models/password.model");

// Batch code generation function for better performance
const generateCodesInBatch = async (prefix, count) => {
  const counter = await Counter.findOneAndUpdate(
    { codeType: prefix },
    { $inc: { seq: count } },
    { new: true, upsert: true }
  );
  const start = counter.seq - count + 1;
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${(start + i).toString().padStart(3, "0")}`
  );
};

const saveCsvToDB = asyncHandler(async (req, res) => {
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
            case "State": {
              const processedStateNames = new Set();
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1; // Add row index starting from 1

                if (!row["State Name"].trim() || !row["Zone Code"].trim()) {
                  row.reason = `Missing required fields at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                const zone = await Zone.findOne({
                  code: row["Zone Code"].trim(),
                });

                if (!zone) {
                  row.reason = `Zone not found at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  continue;
                }

                if (row["Zone Name"].trim() !== zone.name) {
                  row.reason = `Zone name mismatch at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  continue;
                }

                const zone_id = zone._id;

                const existingState = await State.findOne({
                  name: row["State Name"].trim(),
                  zoneId: zone_id,
                });

                if (existingState) {
                  processedStateNames.add(row["State Name"].trim());
                  row.reason = `Duplicate state name at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  continue;
                }

                row["Zone Code"] = zone_id;
              }

              const validStates = results.filter(
                (row) =>
                  row["State Name"] &&
                  row["Zone Code"] &&
                  !processedStateNames.has(row["State Name"].trim())
              );

              if (validStates.length > 0) {
                const stateDocs = await Promise.all(
                  validStates.map(async (row) => {
                    const StateCode = await generateCode("ST-LX");
                    return {
                      name: row["State Name"].trim(),
                      code: StateCode,
                      zoneId: row["Zone Code"],
                    };
                  })
                );

                resp = await State.insertMany(stateDocs);
              } else {
                console.warn("No valid results to save after filtering");
              }
              break;
            }

            case "Region": {
              const processedRegionNames = new Set();
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1; // Add row index starting from 1

                if (
                  !row["Region Name"].trim() ||
                  !row["Zone Code"].trim() ||
                  !row["State Code"].trim()
                ) {
                  row.reason = `Missing required fields at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                const zone = await Zone.findOne({
                  code: row["Zone Code"].trim(),
                });
                const state = await State.findOne({
                  slug: row["State Code"].trim(),
                });

                if (!zone || !state) {
                  row.reason = `Zone or State not found at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  row["State Code"] = null;
                  continue;
                }

                if (row["Zone Name"].trim() !== zone.name) {
                  row.reason = `Zone name mismatch at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  continue;
                }

                if (row["State Name"].trim() !== state.name) {
                  row.reason = `State name mismatch at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["State Code"] = null;
                  continue;
                }

                const zone_id = zone._id;
                const state_id = state._id;

                const existingRegion = await Region.findOne({
                  name: row["Region Name"].trim(),
                  zoneId: zone_id,
                  stateId: state_id,
                });

                if (existingRegion) {
                  processedRegionNames.add(row["Region Name"].trim());
                  row.reason = `Duplicate region name at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Zone Code"] = null;
                  row["State Code"] = null;
                  continue;
                }

                row["Zone Code"] = zone._id;
                row["State Code"] = state._id;
              }

              const validRegions = results.filter(
                (row) =>
                  row["Zone Code"] &&
                  row["Region Name"] &&
                  row["State Code"] &&
                  !processedRegionNames.has(row["Region Name"].trim())
              );

              if (validRegions.length > 0) {
                const regionDocs = await Promise.all(
                  validRegions.map(async (row) => {
                    const RegionCode = await generateCode("REG-LX");
                    return {
                      name: row["Region Name"].trim(),
                      code: RegionCode,
                      zoneId: row["Zone Code"],
                      stateId: row["State Code"],
                    };
                  })
                );

                resp = await Region.insertMany(regionDocs);
              } else {
                console.warn("No valid results to save after filtering");
              }
              break;
            }

            case "Brand": {
              const processedBrandNames = new Set();
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1;

                if (!row["Brand Name"]?.trim()) {
                  row.reason = `Missing required fields at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                const existingBrand = await Brand.findOne({
                  name: row["Brand Name"].trim(),
                });

                if (existingBrand) {
                  processedBrandNames.add(row["Brand Name"].trim());
                  row.reason = `Duplicate brand name at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }
              }

              const validBrands = results.filter(
                (row) =>
                  row["Brand Name"] &&
                  !processedBrandNames.has(row["Brand Name"].trim())
              );

              if (validBrands.length > 0) {
                const brandDocs = await Promise.all(
                  validBrands.map(async (row) => {
                    return {
                      name: row["Brand Name"].trim(),
                      code: row["Brand Name"].trim(),
                      desc: row["Brand Description"]?.trim() || null,
                      image_path: row["Image Path"]?.trim() || null,
                      slug: row["Slug"]?.trim() || null,
                      status: true,
                    };
                  })
                );

                resp = await Brand.insertMany(brandDocs);
              } else {
                console.warn("No valid results to save after filtering");
              }
              break;
            }

            case "Category": {
              const processedCategoryNames = new Set();
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1;

                if (!row["Category Name"].trim()) {
                  row.reason = `Missing required fields at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                const existingCategory = await Category.findOne({
                  name: row["Category Name"].trim(),
                });

                if (existingCategory) {
                  processedCategoryNames.add(row["Category Name"].trim());
                  row.reason = `Duplicate category name at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }
              }

              const validCategories = results.filter(
                (row) =>
                  row["Category Name"] &&
                  !processedCategoryNames.has(row["Category Name"].trim())
              );
              if (validCategories.length > 0) {
                const categoryDocs = await Promise.all(
                  validCategories.map(async (row) => {
                    const CategoryCode = row["Category Name"];
                    return {
                      name: row["Category Name"].trim(),
                      code: CategoryCode,
                      image_path: row["Image Path"]
                        ? row["Image Path"].trim()
                        : null,
                      slug: row.slug || null,
                    };
                  })
                );

                resp = await Category.insertMany(categoryDocs);
              } else {
                console.warn("No valid results to save after filtering");
              }
              break;
            }

            case "Collection": {
              const processedCollectionNames = new Set();
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1;

                if (
                  !row["Collection Name"].trim() ||
                  !row["Category Code"].trim()
                ) {
                  row.reason = `Missing required fields at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                const category = await Category.findOne({
                  code: row["Category Code"].trim(),
                });

                if (!category) {
                  row.reason = `Category not found at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Category Code"] = null;
                  continue;
                }

                if (row["Category Name"].trim() !== category.name) {
                  row.reason = `Category name mismatch at row ${row.index}`;
                  skippedRows.push({ ...row });
                  row["Category Code"] = null;
                  continue;
                }

                const cat_id = category._id;

                const existingCollection = await Collection.findOne({
                  $and: [
                    { name: row["Collection Name"].trim() },
                    { cat_id: cat_id },
                  ],
                });

                if (existingCollection) {
                  processedCollectionNames.add(row["Collection Name"].trim());
                  row.reason = `Duplicate collection name at row ${row.index}`;
                  skippedRows.push({ ...row });
                  continue;
                }

                row["Category Code"] = cat_id;
              }

              const validCollections = results.filter(
                (row) =>
                  row["Collection Name"] &&
                  row["Category Code"] &&
                  !processedCollectionNames.has(row["Collection Name"].trim())
              );

              if (validCollections.length > 0) {
                const collectionDocs = await Promise.all(
                  validCollections.map(async (row) => {
                    const CollectionCode = row["Collection Name"];
                    return {
                      name: row["Collection Name"].trim(),
                      code: CollectionCode,
                      cat_id: row["Category Code"],
                      image_path: row["Image Path"]
                        ? row["Image Path"].trim()
                        : null,
                      slug: row.slug || null,
                      description: row["Collection Description"]
                        ? row["Collection Description"].trim()
                        : null,
                    };
                  })
                );

                resp = await Collection.insertMany(collectionDocs);
              } else {
                console.warn("No valid results to save after filtering");
              }
              break;
            }

            case "Product": {
              console.log("Processing Product CSV with 43,000+ records");

              // Increased batch size for better performance with large datasets
              const BATCH_SIZE = 5000; // Optimal for most MongoDB configurations
              const DB_BATCH_SIZE = 1000; // For bulk inserts

              let totalProcessed = 0;
              let totalInserted = 0;
              let totalSkipped = 0;

              try {
                // Step 1: Extract unique codes efficiently
                console.log("Extracting unique codes from CSV...");
                const uniqueCodes = {
                  categories: new Set(),
                  collections: new Set(),
                  brands: new Set(),
                  subBrands: new Set(),
                  suppliers: new Set(),
                  products: new Set(),
                };

                results.forEach((row) => {
                  if (row["Category Code"]?.trim())
                    uniqueCodes.categories.add(row["Category Code"].trim());
                  if (row["Collection Code"]?.trim())
                    uniqueCodes.collections.add(row["Collection Code"].trim());
                  if (row["Brand Code"]?.trim())
                    uniqueCodes.brands.add(row["Brand Code"].trim());
                  if (row["Sub Brand Code"]?.trim())
                    uniqueCodes.subBrands.add(row["Sub Brand Code"].trim());
                  if (row["Supplier Code"]?.trim())
                    uniqueCodes.suppliers.add(row["Supplier Code"].trim());
                  if (row["Product Code"]?.trim())
                    uniqueCodes.products.add(row["Product Code"].trim());
                });

                console.log(
                  `Found unique codes - Categories: ${uniqueCodes.categories.size}, Collections: ${uniqueCodes.collections.size}, Brands: ${uniqueCodes.brands.size}, SubBrands: ${uniqueCodes.subBrands.size}, Suppliers: ${uniqueCodes.suppliers.size}, Products: ${uniqueCodes.products.size}`
                );

                // Step 2: Batch fetch related entities
                console.log("Fetching related entities from database...");
                const [
                  categories,
                  collections,
                  brands,
                  subBrands,
                  suppliers,
                  existingProducts,
                ] = await Promise.all([
                  Category.find({
                    code: { $in: Array.from(uniqueCodes.categories) },
                  })
                    .select("code _id")
                    .lean(),
                  Collection.find({
                    code: { $in: Array.from(uniqueCodes.collections) },
                  })
                    .select("code _id")
                    .lean(),
                  Brand.find({ code: { $in: Array.from(uniqueCodes.brands) } })
                    .select("code _id")
                    .lean(),
                  SubBrand.find({
                    code: { $in: Array.from(uniqueCodes.subBrands) },
                  })
                    .select("code _id")
                    .lean(),
                  Supplier.find({
                    supplierCode: { $in: Array.from(uniqueCodes.suppliers) },
                  })
                    .select("supplierCode _id")
                    .lean(),
                  Product.find({
                    product_code: { $in: Array.from(uniqueCodes.products) },
                  })
                    .select("product_code")
                    .lean(),
                ]);

                // Step 3: Create lookup maps
                const lookupMaps = {
                  categories: new Map(
                    categories.map((cat) => [cat.code, cat._id])
                  ),
                  collections: new Map(
                    collections.map((col) => [col.code, col._id])
                  ),
                  brands: new Map(
                    brands.map((brand) => [brand.code, brand._id])
                  ),
                  subBrands: new Map(
                    subBrands.map((sub) => [sub.code, sub._id])
                  ),
                  suppliers: new Map(
                    suppliers.map((sup) => [sup.supplierCode, sup._id])
                  ),
                  existingProducts: new Set(
                    existingProducts.map((prod) => prod.product_code)
                  ),
                };

                console.log("Lookup maps created successfully");

                const requiredFields = [
                  "Product Code",
                  "Product Name",
                  "Brand Code",
                  "Sub Brand Code",
                  "Collection Code",
                  "Category Code",
                  "Supplier Code",
                  "SKU Group Name",
                  "SKU Group Code",
                  "Product Size",
                ];

                // Step 4: Process data in batches
                for (
                  let batchStart = 0;
                  batchStart < results.length;
                  batchStart += BATCH_SIZE
                ) {
                  const batch = results.slice(
                    batchStart,
                    batchStart + BATCH_SIZE
                  );
                  const productsToInsert = [];

                  console.log(
                    `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1
                    }/${Math.ceil(results.length / BATCH_SIZE)} (rows ${batchStart + 1
                    }-${Math.min(batchStart + BATCH_SIZE, results.length)})`
                  );

                  // Process each row in the batch
                  for (let i = 0; i < batch.length; i++) {
                    const row = batch[i];
                    const globalIndex = batchStart + i;
                    row.index = globalIndex + 1;
                    totalProcessed++;


                    // Quick validation
                    const missingFields = requiredFields.filter(
                      (field) => !row[field]?.trim()
                    );
                    if (missingFields.length > 0) {
                      row.reason = `Missing required fields: ${missingFields.join(
                        ", "
                      )}`;
                      skippedRows.push({ ...row });
                      totalSkipped++;
                      continue;
                    }

                    const productCode = row["Product Code"].trim();
                    const productName = row["Product Name"].trim();

                    // Check ONLY for duplicate product codes (removed product name check)
                    if (lookupMaps.existingProducts.has(productCode)) {
                      row.reason = `Duplicate product code: ${productCode}`;
                      skippedRows.push({ ...row });
                      totalSkipped++;
                      continue;
                    }

                    // Lookup related entities
                    const categoryId = lookupMaps.categories.get(
                      row["Category Code"].trim()
                    );
                    const collectionId = lookupMaps.collections.get(
                      row["Collection Code"].trim()
                    );
                    const brandId = lookupMaps.brands.get(
                      row["Brand Code"].trim()
                    );
                    const subBrandId = lookupMaps.subBrands.get(
                      row["Sub Brand Code"].trim()
                    );
                    const supplierId = lookupMaps.suppliers.get(
                      row["Supplier Code"].trim()
                    );

                    if (
                      !categoryId ||
                      !collectionId ||
                      !brandId ||
                      !subBrandId ||
                      !supplierId
                    ) {
                      const missing = [];
                      if (!categoryId) missing.push("Category");
                      if (!collectionId) missing.push("Collection");
                      if (!brandId) missing.push("Brand");
                      if (!subBrandId) missing.push("Sub Brand");
                      if (!supplierId) missing.push("Supplier");

                      row.reason = `${missing.join(", ")} not found`;
                      skippedRows.push({ ...row });
                      totalSkipped++;
                      continue;
                    }

                    // Helper function for safe trimming
                    const safeTrim = (value) =>
                      value?.toString().trim() || null;

                    // Create product object
                    const product = {
                      name: productName,
                      product_code: productCode,
                      sku_group_id: safeTrim(row["SKU Group Code"]),
                      sku_group__name: safeTrim(row["SKU Group Name"]),
                      cat_id: categoryId,
                      collection_id: collectionId,
                      brand: brandId,
                      subBrand: subBrandId,
                      supplier: supplierId,
                      size: safeTrim(row["Product Size"]),
                      color: safeTrim(row["Product Color"]),
                      pack: safeTrim(row["Product Pack"]),
                      no_of_pieces_in_a_box: safeTrim(row["Pieces in a box"]),
                      img_path: safeTrim(row["Image Path"]),
                      product_type: safeTrim(row["Product Type"]),
                      product_valuation_type: safeTrim(
                        row["Product Valuation Type"]
                      ),
                      product_hsn_code: safeTrim(row["Product HSN Code"]),
                      base_point: safeTrim(row["Base Points"]),
                      cgst: safeTrim(row.CGST),
                      sgst: safeTrim(row.SGST),
                      igst: safeTrim(row.IGST),
                      sbu: safeTrim(row.SBU),
                      uom: safeTrim(row["Unit of Measure"]),
                    };

                    productsToInsert.push(product);
                    lookupMaps.existingProducts.add(productCode); // Prevent duplicates in subsequent batches
                  }

                  // Step 5: Bulk insert in smaller chunks
                  if (productsToInsert.length > 0) {
                    console.log(
                      `Inserting ${productsToInsert.length} products from current batch...`
                    );

                    // Insert in smaller chunks to avoid MongoDB limits
                    for (
                      let chunkStart = 0;
                      chunkStart < productsToInsert.length;
                      chunkStart += DB_BATCH_SIZE
                    ) {
                      const chunk = productsToInsert.slice(
                        chunkStart,
                        chunkStart + DB_BATCH_SIZE
                      );

                      try {
                        const insertResult = await Product.insertMany(chunk, {
                          ordered: false,
                          writeConcern: { w: 1, j: false }, // Faster writes
                        });

                        totalInserted += insertResult.length;
                        resp.push(...insertResult);

                        console.log(
                          `Chunk inserted: ${insertResult.length} products (Total: ${totalInserted})`
                        );
                      } catch (error) {
                        console.error(`Chunk insert error:`, error.message);

                        if (error.writeErrors) {
                          const successCount =
                            chunk.length - error.writeErrors.length;
                          totalInserted += successCount;

                          // Add failed records to skipped
                          error.writeErrors.forEach((writeError) => {
                            const failedProduct = chunk[writeError.index];
                            skippedRows.push({
                              ...failedProduct,
                              reason: `Insert error: ${writeError.errmsg}`,
                              index: chunkStart + writeError.index + 1,
                            });
                            totalSkipped++;
                          });

                          console.log(
                            `Partial success: ${successCount} inserted, ${error.writeErrors.length} failed`
                          );
                        } else {
                          // Complete chunk failure
                          chunk.forEach((product, index) => {
                            skippedRows.push({
                              ...product,
                              reason: `Bulk insert failed: ${error.message}`,
                              index: chunkStart + index + 1,
                            });
                            totalSkipped++;
                          });
                        }
                      }
                    }
                  }

                  // Progress logging
                  const progress = (
                    ((batchStart + batch.length) / results.length) *
                    100
                  ).toFixed(1);
                  console.log(
                    `Batch completed. Progress: ${progress}% (${totalProcessed}/${results.length} processed, ${totalInserted} inserted, ${totalSkipped} skipped)`
                  );

                  // Optional: Add small delay to prevent overwhelming the database
                  if (batchStart + BATCH_SIZE < results.length) {
                    await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
                  }
                }

                console.log(`\n=== FINAL SUMMARY ===`);
                console.log(`Total Processed: ${totalProcessed}`);
                console.log(`Successfully Inserted: ${totalInserted}`);
                console.log(`Skipped/Failed: ${totalSkipped}`);
                console.log(
                  `Success Rate: ${(
                    (totalInserted / totalProcessed) *
                    100
                  ).toFixed(2)}%`
                );
              } catch (error) {
                console.error(
                  "Critical error during product processing:",
                  error
                );
                throw error; // Re-throw to handle at higher level
              }

              break;
            }

            case "Price": {
              console.log("Processing Price CSV");

              // 1. Collect unique codes for batch DB queries (trimmed)
              const regionCodes = new Set();
              const productCodes = new Set();
              const distributorCodes = new Set();

              for (const row of results) {
                if (row["Region Code"])
                  regionCodes.add(row["Region Code"].trim());
                if (row["Product Code"])
                  productCodes.add(row["Product Code"].trim());
                if (row["Distributor Code"])
                  distributorCodes.add(row["Distributor Code"].trim());
              }

              // 2. Fetch all required docs in parallel
              const [regions, products, distributors] = await Promise.all([
                Region.find({ code: { $in: Array.from(regionCodes) } })
                  .select("code _id")
                  .lean(),
                Product.find({
                  product_code: { $in: Array.from(productCodes) },
                })
                  .select("product_code _id")
                  .lean(),
                Distributor.find({
                  dbCode: { $in: Array.from(distributorCodes) },
                })
                  .select("dbCode _id")
                  .lean(),
              ]);

              // 3. Create lookup maps for quick access
              const regionMap = new Map(
                regions.map((r) => [r.code.trim(), r._id])
              );
              const productMap = new Map(
                products.map((p) => [p.product_code.trim(), p._id])
              );
              const distributorMap = new Map(
                distributors.map((d) => [d.dbCode.trim(), d._id])
              );

              // 4. Pre-validate rows and collect valid combinations for existing price lookup
              const skippedRowsForPrice = [];
              const preValidatedRows = [];
              const dateToday = new Date();
              const validCombinations = [];

              for (const row of results) {
                const regionCode = row["Region Code"]?.trim();
                const productCode = row["Product Code"]?.trim();
                const distributorCode = row["Distributor Code"]?.trim();
                const mrp = row["MRP"]?.trim();
                const effectiveDate = row["Effective Date"]?.trim();

                // Basic field validation - for national pricing, region and distributor are not required
                const isNationalPricing = !regionCode && !distributorCode;
                if (!productCode || !mrp || !effectiveDate) {
                  skippedRowsForPrice.push({
                    ...row,
                    reason:
                      "Missing required fields (Product Code, MRP, Effective Date)",
                  });
                  continue;
                }

                // Entity existence validation
                const regionId = regionCode ? regionMap.get(regionCode) : null;
                const productId = productMap.get(productCode);
                const distributorId = distributorCode
                  ? distributorMap.get(distributorCode)
                  : null;

                if (!productId) {
                  skippedRowsForPrice.push({
                    ...row,
                    reason: "Product not found",
                  });
                  continue;
                }

                // For regional/distributor pricing, region is required
                if (!isNationalPricing && !regionId) {
                  skippedRowsForPrice.push({
                    ...row,
                    reason:
                      "Region not found (required for regional/distributor pricing)",
                  });
                  continue;
                }

                // For distributor pricing, distributor must exist
                if (distributorCode && !distributorId) {
                  skippedRowsForPrice.push({
                    ...row,
                    reason: "Distributor not found",
                  });
                  continue;
                }

                // Date validation
                const parsedDate = moment(effectiveDate, "DD-MM-YYYY");
                if (!parsedDate.isValid()) {
                  skippedRowsForPrice.push({
                    ...row,
                    reason: "Invalid Effective Date",
                  });
                  continue;
                }
                const effectiveDateParsed = moment
                  .tz(
                    parsedDate.format("YYYY-MM-DD"),
                    "YYYY-MM-DD",
                    "Asia/Kolkata"
                  )
                  .startOf("day")
                  .toDate();

                // Note: Date validation will be done later after checking existing prices
                // For now, just store the parsed date

                // Determine price type based on what's provided
                let priceType;
                if (distributorCode) {
                  priceType = "distributor";
                } else if (regionCode) {
                  priceType = "regional";
                } else {
                  priceType = "national";
                }

                // Store pre-validated row
                const validatedRow = {
                  ...row,
                  regionId,
                  productId,
                  distributorId,
                  priceType: priceType,
                  effectiveDate: effectiveDateParsed,
                };

                preValidatedRows.push(validatedRow);

                // Collect combination for batch existing price lookup
                validCombinations.push({
                  productId,
                  regionId: regionId || null,
                  distributorId,
                });
              }
              console.log(
                `Pre-validation complete: ${preValidatedRows.length} valid, ${skippedRowsForPrice.length} skipped (basic validation)`
              );

              // 5. Batch fetch all existing prices for valid combinations
              let existingPricesMap = new Map();
              if (validCombinations.length > 0) {
                const existingPricesQuery = validCombinations.map((combo) => ({
                  productId: combo.productId,
                  regionId: combo.regionId,
                  distributorId: combo.distributorId,
                  status: true,
                }));

                const existingPrices = await Price.find({
                  $or: existingPricesQuery,
                })
                  .select("productId regionId distributorId effective_date _id")
                  .sort({ effective_date: -1 })
                  .lean();

                // Group existing prices by combination key
                existingPrices.forEach((price) => {
                  const key = `${price.productId}_${price.regionId || "null"}_${price.distributorId || "null"
                    }`;
                  if (!existingPricesMap.has(key)) {
                    existingPricesMap.set(key, []);
                  }
                  existingPricesMap.get(key).push(price);
                });
              }

              console.log(
                `Found ${existingPricesMap.size} existing price combinations`
              ); // 6. Final validation with existing price checks and date validation
              const validRows = [];

              for (const row of preValidatedRows) {
                const combinationKey = `${row.productId}_${row.regionId || "null"
                  }_${row.distributorId || "null"}`;
                const existingPrices =
                  existingPricesMap.get(combinationKey) || [];

                // Date validation based on existing prices
                if (existingPrices.length > 0) {
                  // If existing prices found, validate against latest price date
                  const latestPrice = existingPrices[0]; // Already sorted by effective_date desc

                  // Validate that new effective date is greater than latest existing price
                  if (
                    moment(latestPrice.effective_date)
                      .tz("Asia/Kolkata")
                      .isSameOrAfter(row.effectiveDate) &&
                    row.SkipEffectiveDateCheck == "1"
                  ) {
                    skippedRowsForPrice.push({
                      ...row,
                      reason:
                        "Price effective date should be greater than the latest existing price effective date",
                    });
                    continue;
                  }
                } else {
                  // No existing prices found for this combination
                  // Allow effective date to be in the past, but still validate it's not too far in the future
                  // Only skip if the effective date is more than 1 year in the future (optional business rule)
                  const oneYearFromNow = moment(dateToday)
                    .add(1, "year")
                    .toDate();
                  if (row.effectiveDate > oneYearFromNow) {
                    skippedRowsForPrice.push({
                      ...row,
                      reason:
                        "Price effective date cannot be more than 1 year in the future",
                    });
                    continue;
                  }
                  // For new price combinations, effective date can be in the past or future (within reason)
                }

                // Add existing prices for later processing
                validRows.push({
                  ...row,
                  existingPrices: existingPrices,
                });
              }
              console.log(
                `Final validation complete: ${validRows.length} valid for insertion, ${skippedRowsForPrice.length} total skipped`
              ); // 7. Process valid rows and handle existing price expiration
              let insertedPrices = [];
              if (validRows.length > 0) {
                // Generate all codes in batch for better performance
                const codes = await generateCodesInBatch(
                  "PR",
                  validRows.length
                );

                const priceDocs = validRows.map((row, idx) => ({
                  code: codes[idx],
                  productId: row.productId,
                  price_type: row.priceType,
                  regionId: row.regionId,
                  mrp_price: row["MRP"],
                  dlp_price: row["DLP"] || null,
                  rlp_price: row["RLP"] || null,
                  effective_date: row.effectiveDate,
                  distributorId: row.distributorId || null,
                  createdBy: req.user._id,
                }));

                // Insert new prices
                insertedPrices = await Price.insertMany(priceDocs);
                console.log(`Inserted ${insertedPrices.length} new prices`);

                // Prepare bulk updates for existing prices with expiration dates
                const priceUpdates = [];
                for (const row of validRows) {
                  if (row.existingPrices && row.existingPrices.length > 0) {
                    const expiresAt = moment(row.effectiveDate)
                      .tz("Asia/Kolkata")
                      .subtract(1, "day")
                      .endOf("day")
                      .toDate();

                    for (const existingPrice of row.existingPrices) {
                      priceUpdates.push({
                        updateOne: {
                          filter: { _id: existingPrice._id },
                          update: {
                            $set: {
                              expiresAt: existingPrice.expiresAt ?? expiresAt,
                            },
                          },
                        },
                      });
                    }
                  }
                }

                // Execute bulk update for existing prices
                if (priceUpdates.length > 0) {
                  await Price.bulkWrite(priceUpdates);
                  console.log(
                    `Updated ${priceUpdates.length} existing prices with expiration dates`
                  );
                }
              } else {
                console.warn("No valid results to save after filtering");
              }

              // 8. Return results
              resp = insertedPrices || [];
              skippedRows = skippedRowsForPrice || [];

              break;
            }

            case "Distributor": {
              console.log("Processing Distributor CSV");

              const BATCH_SIZE = 100;
              let totalProcessed = 0;
              let totalInserted = 0;
              let totalSkipped = 0;
              let skippedRowsForDistributor = [];

              try {
                // 1. Collect unique codes for batch DB queries
                const stateCodes = new Set();
                const brandCodes = new Set();

                // First pass: collect all unique codes
                for (const row of results) {
                  if (row["State Code (Required)"])
                    stateCodes.add(row["State Code (Required)"].trim());
                  if (row["Brands (Required)"]) {
                    row["Brands (Required)"]
                      .split(",")
                      .forEach((code) => brandCodes.add(code.trim()));
                  }
                }

                // 2. Fetch all required data in parallel
                const [states, brands] = await Promise.all([
                  State.find({ slug: { $in: Array.from(stateCodes) } }) // ✅ Changed from 'code' to 'slug'
                    .select("code name slug _id") // ✅ Added 'slug' to select
                    .lean(),
                  Brand.find({ code: { $in: Array.from(brandCodes) } })
                    .select("code _id")
                    .lean(),
                ]);

                // Create lookup maps
                const stateMap = new Map(states.map((s) => [s.slug.trim(), s])); // ✅ Changed from 'code' to 'slug'
                const brandMap = new Map(
                  brands.map((b) => [b.code.trim(), b._id])
                );

                // 3. Pre-validate rows
                const validRows = [];

                for (let i = 0; i < results.length; i++) {
                  const row = results[i];
                  const rowNum = i + 2;

                  // Fixed field names to match CSV headers
                  if (!row["DB Code (Required)"]?.trim()) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "DB Code is required",
                    });
                    continue;
                  }

                  if (!row["Name (Required)"]?.trim()) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "Name is required",
                    });
                    continue;
                  }

                  if (!row["Email (Required)"]?.trim()) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "Email is required",
                    });
                    continue;
                  }

                  if (!row["State Code (Required)"]?.trim()) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "State Code is required",
                    });
                    continue;
                  }

                  // Validate RBP Schema Mapped field
                  if (!row["RBP Schema Mapped (Required)"]?.trim()) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "RBP Schema Mapped is required",
                    });
                    continue;
                  }

                  // Process and validate RBP Schema Mapped value
                  const rbpSchemaMapped = row["RBP Schema Mapped (Required)"]
                    .trim()
                    .toLowerCase();

                  if (!["yes", "no"].includes(rbpSchemaMapped)) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: "RBP Schema Mapped must be 'yes' or 'no'",
                    });
                    continue;
                  }

                  // Validate state and get region - ✅ Now using slug lookup
                  const state = stateMap.get(
                    row["State Code (Required)"].trim()
                  );
                  if (!state) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: `Invalid State Code: ${row["State Code (Required)"]}`,
                    });
                    continue;
                  }

                  // Find region for the state
                  const region = await Region.findOne({ stateId: state._id });
                  if (!region) {
                    skippedRowsForDistributor.push({
                      row: rowNum,
                      reason: `No region found for State Code: ${row["State Code (Required)"]}`,
                    });
                    continue;
                  }

                  // Process brands
                  const brandIds = [];
                  if (row["Brands (Required)"]) {
                    const brandCodes = row["Brands (Required)"]
                      .split(",")
                      .map((code) => code.trim());
                    for (const code of brandCodes) {
                      const brandId = brandMap.get(code);
                      if (brandId) {
                        brandIds.push(brandId);
                      }
                    }
                  }

                  // Generate passwords
                  // const password = Math.random().toString(36).slice(-8);
                  const password = "123456";
                  // const genPassword = Math.random().toString(36).slice(-8);
                  const genPassword = "secret";

                  const currentDate = new Date();

                  validRows.push({
                    rowNum,
                    data: {
                      name: row["Name (Required)"].trim(),
                      email: row["Email (Required)"].trim(),
                      dbCode: row["DB Code (Required)"].trim(),
                      password,
                      genPassword,
                      role: row["Distributor Type (Required)"]?.trim() || "GT",
                      regionId: region._id,
                      stateId: state._id,
                      status: true,
                      avatar: "https://img.icons8.com/officel/80/user.png",
                      address1: row["Address 1"]?.trim(),
                      address2: row["Address 2"]?.trim(),
                      phone: row["Phone (Required)"]?.trim(),
                      gst_no: row["GST No"]?.trim(),
                      pan_no: row["PAN No"]?.trim(),
                      ownerName: row["Owner Name"]?.trim(),
                      city: row["City"]?.trim(),
                      pincode: row["Pincode"]?.trim(),
                      RBPSchemeMapped: rbpSchemaMapped, // Add the processed field
                      area: row["Area"]
                        ? row["Area"].split(",").map((a) => a.trim())
                        : [],
                      dayOff: row["Day Off"]
                        ? row["Day Off"].split(",").map((d) => d.trim())
                        : [],
                      brandId: brandIds,
                      createdBy: req.user?._id || null,
                    },
                  });
                }

                console.log(
                  `Pre-validation complete: ${validRows.length} valid, ${skippedRowsForDistributor.length} skipped`
                );

                // 4. Check for duplicate emails and dbCodes
                const existingDistributors = await Distributor.find({
                  $or: [
                    { email: { $in: validRows.map((r) => r.data.email) } },
                    { dbCode: { $in: validRows.map((r) => r.data.dbCode) } },
                  ],
                })
                  .select("email dbCode")
                  .lean();

                const existingEmails = new Set(
                  existingDistributors.map((d) => d.email)
                );
                const existingDbCodes = new Set(
                  existingDistributors.map((d) => d.dbCode)
                );

                const finalValidRows = validRows.filter((row) => {
                  if (existingDbCodes.has(row.data.dbCode)) {
                    skippedRowsForDistributor.push({
                      row: row.rowNum,
                      reason: `DB Code already exists: ${row.data.dbCode}`,
                    });
                    return false;
                  }
                  if (existingEmails.has(row.data.email)) {
                    skippedRowsForDistributor.push({
                      row: row.rowNum,
                      reason: `Email already exists: ${row.data.email}`,
                    });
                    return false;
                  }

                  return true;
                });

                // 5. Process in batches
                const insertedDistributors = [];
                for (let i = 0; i < finalValidRows.length; i += BATCH_SIZE) {
                  const batch = finalValidRows.slice(i, i + BATCH_SIZE);
                  console.log(
                    `Processing batch ${i / BATCH_SIZE + 1}, size: ${batch.length
                    }`
                  );

                  const batchPromises = batch.map(async (row) => {
                    try {
                      const distributor = await Distributor.create({
                        ...row.data,
                        // No need to set _updatedBy here since it's initial creation
                      });
                      // Create bank account
                      await DbBank.create({
                        distributorId: distributor._id,
                      });

                      // Save password
                      await Password.create({
                        userId: distributor._id,
                        password: row.data.password,
                        genPassword: row.data.genPassword,
                      });

                      totalInserted++;
                      return distributor;
                    } catch (error) {
                      console.error(
                        `Error processing row ${row.rowNum}:`,
                        error
                      );
                      skippedRowsForDistributor.push({
                        row: row.rowNum,
                        reason: `Error: ${error.message}`,
                      });
                      return null;
                    }
                  });

                  const batchResults = await Promise.all(batchPromises);
                  insertedDistributors.push(...batchResults.filter(Boolean));
                  totalProcessed += batch.length;
                }

                console.log("\nDistributor bulk upload completed:");
                console.log(`- Total rows processed: ${results.length}`);
                console.log(`- Successfully inserted: ${totalInserted}`);
                console.log(
                  `- Skipped rows: ${skippedRowsForDistributor.length}`
                );

                resp = insertedDistributors;
                skippedRows = skippedRowsForDistributor;
              } catch (error) {
                console.error("Error during distributor processing:", error);
                throw new Error(
                  error?.message || "Failed to process distributors"
                );
              }

              break;
            }

            case "outlet": {
              console.log("Processing Outlet CSV");
              const getMobile1 = (row) =>
                (row["Mobile Number"] ||
                  row["Mobile 1"] ||
                  "").toString().trim();


              const getMobile2 = (row) =>
                (row["Alternate Number"] ||
                  row["Mobile 2"] ||
                  "").toString().trim();

              // Batch processing configuration
              const BATCH_SIZE = 1000;
              let totalProcessed = 0;
              let totalInserted = 0;
              let totalSkipped = 0;

              try {
                // Step 1: Extract unique codes for batch DB queries
                console.log("Extracting unique codes from CSV...");
                const uniqueCodes = {
                  employees: new Set(),
                  beats: new Set(),
                  zones: new Set(),
                  states: new Set(),
                  regions: new Set(),
                  districts: new Set(),
                  brands: new Set(),
                  outlets: new Set(),
                  outletUIDs: new Set(),
                  mobiles: new Set(),
                };

                // Extract all unique codes from results
                console.log(results);
                results.forEach((row) => {
                  if (row["Employee Code"]?.trim())
                    uniqueCodes.employees.add(row["Employee Code"].trim());

                  if (row["Beat Code"]?.trim()) {
                    row["Beat Code"]
                      .split(",")
                      .map((code) => code.trim())
                      .filter(Boolean)
                      .forEach((code) => uniqueCodes.beats.add(code));
                  }

                  if (row["Zone Code"]?.trim())
                    uniqueCodes.zones.add(row["Zone Code"].trim());
                  if (row["State Code"]?.trim())
                    uniqueCodes.states.add(row["State Code"].trim());
                  if (row["District Code"]?.trim())
                    uniqueCodes.districts.add(row["District Code"].trim());
                  if (row["Brand Code"]?.trim())
                    uniqueCodes.brands.add(row["Brand Code"].trim());
                  if (row["Outlet Code"]?.trim())
                    uniqueCodes.outlets.add(row["Outlet Code"].trim());
                  if (row["Outlet UID"]?.trim())
                    uniqueCodes.outletUIDs.add(row["Outlet UID"].trim());

                  const mobile1 = getMobile1(row);
                  if (mobile1) uniqueCodes.mobiles.add(mobile1);
                });

                console.log(
                  `Found unique codes - Employees: ${uniqueCodes.employees.size}, Beats: ${uniqueCodes.beats.size}, Zones: ${uniqueCodes.zones.size}, States: ${uniqueCodes.states.size}, Districts: ${uniqueCodes.districts.size}, Brands: ${uniqueCodes.brands.size}, Outlets: ${uniqueCodes.outlets.size}, OutletUIDs: ${uniqueCodes.outletUIDs.size}, Mobiles: ${uniqueCodes.mobiles.size}`
                );

                // Step 2: Batch fetch related entities
                console.log("Fetching related entities from database...");
                const [
                  employees,
                  beats,
                  zones,
                  states,
                  allRegions,
                  districts,
                  brands,
                  existingOutlets,
                  existingOutletsApproved,
                  existingOutletsWithMobiles,
                ] = await Promise.all([
                  Employee.find({
                    empId: { $in: Array.from(uniqueCodes.employees) },
                  })
                    .select("empId _id")
                    .lean(),
                  Beat.find({ code: { $in: Array.from(uniqueCodes.beats) } })
                    .select("code _id regionId")
                    .lean(),

                  Zone.find({ code: { $in: Array.from(uniqueCodes.zones) } })
                    .select("code _id")
                    .lean(),
                  State.find({ slug: { $in: Array.from(uniqueCodes.states) } })
                    .select("slug _id")
                    .lean(),
                  Region.find().select("_id stateId").lean(),
                  District.find({
                    code: { $in: Array.from(uniqueCodes.districts) },
                  })
                    .select("code _id")
                    .lean(),
                  Brand.find({ code: { $in: Array.from(uniqueCodes.brands) } })
                    .select("code _id")
                    .lean(),
                  Outlet.find({
                    $or: [
                      { outletCode: { $in: Array.from(uniqueCodes.outlets) } },
                      {
                        outletUID: { $in: Array.from(uniqueCodes.outletUIDs) },
                      },
                    ],
                  })
                    .select("outletCode outletUID")
                    .lean(),
                  OutletApproved.find({
                    $or: [
                      { outletCode: { $in: Array.from(uniqueCodes.outlets) } },
                      {
                        outletUID: { $in: Array.from(uniqueCodes.outletUIDs) },
                      },
                    ],
                  })
                    .select("outletCode outletUID")
                    .lean(),
                  Outlet.find({
                    mobile1: {
                      $in: Array.from(uniqueCodes.mobiles),
                      $nin: [null, ""],
                    },
                  })
                    .select("mobile1")
                    .lean(),
                ]);

                // Step 3: Create lookup maps
                const lookupMaps = {
                  employees: new Map(
                    employees.map((emp) => [emp.empId, emp._id])
                  ),
                  beats: new Map(beats.map((beat) => [beat.code, beat._id])),
                  zones: new Map(zones.map((zone) => [zone.code, zone._id])),
                  states: new Map(
                    states.map((state) => [state.slug, state._id])
                  ),
                  regionsByStateId: new Map(
                    allRegions.map((region) => [
                      region.stateId.toString(),
                      region._id,
                    ])
                  ),
                  districts: new Map(
                    districts.map((district) => [district.code, district._id])
                  ),
                  brands: new Map(
                    brands.map((brand) => [brand.code, brand._id])
                  ),
                  existingOutletCodes: new Set(
                    existingOutlets
                      .map((outlet) => outlet.outletCode)
                      .filter(Boolean)
                  ),
                  existingOutletUIDs: new Set(
                    existingOutlets
                      .map((outlet) => outlet.outletUID)
                      .filter(Boolean)
                  ),
                  existingOutletCodesApproved: new Set(
                    existingOutletsApproved
                      .map((outlet) => outlet.outletCode)
                      .filter(Boolean)
                  ),
                  existingOutletUIDsApproved: new Set(
                    existingOutletsApproved
                      .map((outlet) => outlet.outletUID)
                      .filter(Boolean)
                  ),
                  existingMobile1s: new Set(
                    existingOutletsWithMobiles
                      .map((outlet) => outlet.mobile1)
                      .filter(Boolean)
                  ),
                };

                console.log("Lookup maps created successfully",lookupMaps);

                // Required fields for outlet
                const requiredFields = [
                  "Outlet Name",
                  "Owner Name",
                  "Employee Code",
                  "Beat Code",
                  "State Code",
                ];

                // Step 4: Process data in batches
                for (
                  let batchStart = 0;
                  batchStart < results.length;
                  batchStart += BATCH_SIZE
                ) {
                  const batch = results.slice(
                    batchStart,
                    batchStart + BATCH_SIZE
                  );
                  const outletsToInsert = [];

                  // Track duplicates within the current batch
                  const batchOutletCodes = new Set();
                  const batchOutletUIDs = new Set();
                  const batchMobile1s = new Set();

                  console.log(
                    `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(results.length / BATCH_SIZE)} (rows ${batchStart + 1}-${Math.min(batchStart + BATCH_SIZE, results.length)})`
                  );

                  // Process each row in the batch
                  for (let i = 0; i < batch.length; i++) {
                    const row = batch[i];
                    const globalIndex = batchStart + i;
                    row.index = globalIndex + 1;
                    totalProcessed++;

                    // Quick validation for required fields
                    const missingFields = requiredFields.filter(
                      (field) => !row[field]?.trim()
                    );

                    if (missingFields.length > 0) {
                      skippedRows.push({
                        ...row,
                        reason: `Missing required fields: ${missingFields.join(", ")} at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Handle outlet code
                    let outletCode = row["Outlet Code"]?.trim();
                    if (!outletCode) {
                      outletCode = await generateCode("OUT-CODE");
                    }

                    // Handle outlet UID
                    let outletUID = row["Outlet UID"]?.trim();
                    if (!outletUID) {
                      outletUID = await generateCode("OUT");
                    }

                    // Check for existing outlet code in database
                    if (lookupMaps.existingOutletCodes.has(outletCode)) {
                      skippedRows.push({
                        ...row,
                        reason: `Outlet with code ${outletCode} already exists at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Check for existing outlet UID in database
                    if (lookupMaps.existingOutletUIDs.has(outletUID)) {
                      skippedRows.push({
                        ...row,
                        reason: `Outlet with UID ${outletUID} already exists at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Check for existing outlet code in approved outlets
                    if (lookupMaps.existingOutletCodesApproved.has(outletCode)) {
                      skippedRows.push({
                        ...row,
                        reason: `Outlet with code ${outletCode} already exists in approved outlets at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Check for existing outlet UID in approved outlets
                    if (lookupMaps.existingOutletUIDsApproved.has(outletUID)) {
                      skippedRows.push({
                        ...row,
                        reason: `Outlet with UID ${outletUID} already exists in approved outlets at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Check for duplicates within current batch
                    if (batchOutletCodes.has(outletCode)) {
                      skippedRows.push({
                        ...row,
                        reason: `Duplicate outlet code ${outletCode} within current batch at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    if (batchOutletUIDs.has(outletUID)) {
                      skippedRows.push({
                        ...row,
                        reason: `Duplicate outlet UID ${outletUID} within current batch at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }


                    // Check for duplicate mobile1
                    const mobile1 = getMobile1(row);

                    if (mobile1) {
                      console.log("Mobile NO", mobile1)
                      // Validate format
                      const mobileRegex = /^[6-9]\d{9}$/;
                      if (!mobileRegex.test(mobile1)) {
                        skippedRows.push({
                          ...row,
                          reason: `Invalid mobile number format: ${mobile1}. Must be a valid 10-digit Indian mobile number starting with 6-9 at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Check if it already exists in database
                      if (lookupMaps.existingMobile1s.has(mobile1)) {
                        skippedRows.push({
                          ...row,
                          reason: `Outlet with mobile number ${mobile1} already exists in database at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Check for duplicate within current batch
                      if (batchMobile1s.has(mobile1)) {
                        skippedRows.push({
                          ...row,
                          reason: `Duplicate mobile number ${mobile1} within current batch at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Validate Aadhar number (12 digits)
                    const aadharNumber = row["Aadhar Number"]?.trim();
                    if (aadharNumber) {
                      const aadharRegex = /^\d{12}$/;
                      if (!aadharRegex.test(aadharNumber)) {
                        skippedRows.push({
                          ...row,
                          reason: `Invalid Aadhaar number format: ${aadharNumber}. Must be a 12-digit number at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Validate PAN number (5 letters + 4 digits + 1 letter)
                    const panNumber = row["PAN Number"]?.trim();
                    if (panNumber) {
                      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
                      if (!panRegex.test(panNumber)) {
                        skippedRows.push({
                          ...row,
                          reason: `Invalid PAN number format: ${panNumber}. Must be in format ABCDE1234F at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Validate GSTIN (15 character format)
                    const gstin = row["GSTIN"]?.trim();
                    if (gstin) {
                      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/i;
                      if (!gstinRegex.test(gstin)) {
                        skippedRows.push({
                          ...row,
                          reason: `Invalid GSTIN format: ${gstin}. Must be in valid 15-character GSTIN format at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Add to batch tracking sets
                    batchOutletCodes.add(outletCode);
                    batchOutletUIDs.add(outletUID);
                    if (mobile1) {
                      batchMobile1s.add(mobile1);
                      lookupMaps.existingMobile1s.add(mobile1);
                    }
                    lookupMaps.existingOutletCodes.add(outletCode);
                    lookupMaps.existingOutletUIDs.add(outletUID);

                    // Lookup foreign key references
                    const employeeId = lookupMaps.employees.get(
                      row["Employee Code"].trim()
                    );

                    const stateId = lookupMaps.states.get(
                      row["State Code"].trim()
                    );

                    // Optional references
                    const zoneId = row["Zone Code"]?.trim()
                      ? lookupMaps.zones.get(row["Zone Code"].trim())
                      : null;

                    // Get regionId from stateId lookup
                    const regionId = stateId
                      ? lookupMaps.regionsByStateId.get(stateId.toString())
                      : null;

                    // Handle distributor lookup
                    let distributorId = null;
                    if (row["Distributor Code"]?.trim()) {
                      const distributor = await Distributor.findOne({
                        dbCode: row["Distributor Code"].trim(),
                      })
                        .select("_id")
                        .lean();
                      distributorId = distributor?._id || null;
                    }

                    const districtId = row["District Code"]?.trim()
                      ? lookupMaps.districts.get(row["District Code"].trim())
                      : null;

                    // Validate required references - Multi beat parsing
                    const beatCodeRaw = row["Beat Code"];
                    const beatCodes = [
                      ...new Set(
                        beatCodeRaw
                          .split(",")
                          .map((code) => code.trim())
                          .filter(Boolean)
                      ),
                    ];

                    

                    const beatIds = [];
                    const invalidBeatCodes = [];

                    beatCodes.forEach((code) => {
                      const beatObjectId = lookupMaps.beats.get(code);
                      if (!beatObjectId) {
                        invalidBeatCodes.push(code);
                      } else {
                        beatIds.push(beatObjectId);
                      }
                    });

                    if (invalidBeatCodes.length > 0) {
                      skippedRows.push({
                        ...row,
                        reason: `Invalid Beat Code(s): ${invalidBeatCodes.join(", ")} at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    if (!stateId) {
                      skippedRows.push({
                        ...row,
                        reason: `State not found for slug ${row["State Code"]} at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Parse selling brands
                    let sellingBrands = [];
                    if (row["Brand Code"]?.trim()) {
                      const brandCodes = row["Brand Code"]
                        .split(",")
                        .map((code) => code.trim())
                        .filter((code) => code.length > 0);

                      sellingBrands = brandCodes
                        .map((code) => lookupMaps.brands.get(code))
                        .filter((id) => id !== undefined);

                      if (brandCodes.length > 0 && sellingBrands.length === 0) {
                        skippedRows.push({
                          ...row,
                          reason: `No valid brands found for codes ${row["Brand Code"]} at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Validate category of outlet
                    const validCategories = ["ECONOMY", "PREMIUM", "RETAILER"];

                    const categoryOfOutlet =
                      row["Category Of Outlet"]?.trim()?.toUpperCase() || "RETAILER";

                    if (!validCategories.includes(categoryOfOutlet)) {
                      skippedRows.push({
                        ...row,
                        reason: `Invalid category of outlet: ${categoryOfOutlet}. Must be one of: ${validCategories.join(", ")}`,
                      });
                      totalSkipped++;
                      continue;
                    }


                    // Validate existing retailer
                    let existingRetailerBool = false;
                    const existingRetailer = row["Existing Retailer"]
                      ?.trim()
                      ?.toUpperCase();
                    if (existingRetailer) {
                      if (["TRUE", "YES", "1"].includes(existingRetailer)) {
                        existingRetailerBool = true;
                      } else if (
                        ["FALSE", "NO", "0"].includes(existingRetailer)
                      ) {
                        existingRetailerBool = false;
                      } else {
                        skippedRows.push({
                          ...row,
                          reason: `Invalid existing retailer value: ${existingRetailer}. Must be TRUE/FALSE, YES/NO, or 1/0 at row ${row.index}`,
                        });
                        totalSkipped++;
                        continue;
                      }
                    }

                    // Validate retailer class
                    const validRetailerClasses = ["A", "B", "C", "D"];
                    const retailerClass = row["Retailer Class"]
                      ?.trim()
                      ?.toUpperCase();
                    if (
                      retailerClass &&
                      !validRetailerClasses.includes(retailerClass)
                    ) {
                      skippedRows.push({
                        ...row,
                        reason: `Invalid retailer class: ${retailerClass}. Must be one of: ${validRetailerClasses.join(", ")} at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Validate enrolled status
                    const validEnrolledStatuses = ["ENROLLED", "NOT ENROLLED"];
                    const enrolledStatus =
                      row["Enrolled Status"]?.trim()?.toUpperCase() ||
                      "NOT ENROLLED";
                    if (!validEnrolledStatuses.includes(enrolledStatus)) {
                      skippedRows.push({
                        ...row,
                        reason: `Invalid enrolled status: ${enrolledStatus}. Must be one of: ${validEnrolledStatuses.join(", ")} at row ${row.index}`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    try {
                      // Generate lead ID
                      const leadId = await generateCode("LD");
                      const mobile2 = getMobile2(row);

                      // Create outlet document
                      const outletDoc = {
                        leadId: leadId,
                        employeeId: employeeId,
                        zoneId: zoneId,
                        stateId: stateId,
                        regionId: regionId,
                        distributorId: distributorId,
                        outletCode: outletCode,
                        outletUID: outletUID,
                        outletName: row["Outlet Name"].trim(),
                        ownerName: row["Owner Name"].trim(),
                        pin: row["PIN"]?.trim() || null,
                        district: districtId,
                        mobile1: mobile1 || null,
                        mobile2: mobile2 || null,
                        whatsappNumber: row["WhatsApp Number"]?.trim() || null,
                        preferredLanguage:
                          row["Preferred Language"]?.trim() || null,
                        teleCallDay: row["Tele Call Day"]?.trim() || null,
                        beatId: beatIds,
                        address1: row["Address 1"]?.trim() || null,
                        address2: row["Address 2"]?.trim() || null,
                        marketCenter: row["Market Center"]?.trim() || null,
                        city: row["City"]?.trim() || null,
                        aadharNumber: row["Aadhar Number"]?.trim() || null,
                        panNumber: row["PAN Number"]?.trim() || null,
                        gstin: row["GSTIN"]?.trim() || null,
                        location: row["Location"]?.trim() || null,
                        gpsLocation: row["GPS Location"]?.trim() || null,
                        categoryOfOutlet: categoryOfOutlet,
                        sellingBrands: sellingBrands,
                        competitorBrands: row["Competitor Brands"]
                          ? row["Competitor Brands"]
                            .split(",")
                            .map((brand) => brand.trim())
                            .filter((brand) => brand.length > 0)
                          : [],
                        existingRetailer: existingRetailerBool,
                        outletStatus: "Pending",
                        outletSource: "Admin",
                        remarks: row["Remarks"]?.trim() || null,
                        contactPerson: row["Contact Person"]?.trim() || null,
                        email: row["Email"]?.trim() || null,
                        retailerClass: retailerClass || null,
                        enrolledStatus: enrolledStatus,
                        shipToAddress: row["Ship To Address"]?.trim() || null,
                        shipToPincode: row["Ship To Pincode"]?.trim() || null,
                        createdBy: req.user?._id || null,
                        createdBy_type: req.user ? "User" : "Employee",
                      };

                      outletsToInsert.push(outletDoc);
                    } catch (error) {
                      console.error(
                        `Error processing row ${row.index}:`,
                        error.message
                      );
                      skippedRows.push({
                        ...row,
                        reason: `Processing error: ${error.message} at row ${row.index}`,
                      });
                      totalSkipped++;
                    }
                  }

                  console.log(" OUTlet To IOnsert ",outletsToInsert);
                  console.log(" OUTlet To IOnsert ",outletsToInsert.length);

                  // Step 5: Bulk insert outlets
                  if (outletsToInsert.length > 0) {
                    try {
                      const insertResult = await Outlet.insertMany(
                        outletsToInsert,
                        {
                          ordered: false,
                          writeConcern: { w: 1, j: false },
                        }
                      );
                      console.log("Insert Result:", insertResult);

                      totalInserted += insertResult.length;
                      if (!resp) resp = [];
                      resp.push(...insertResult);

                      console.log(
                        `Batch inserted: ${insertResult.length} outlets (Total: ${totalInserted})`
                      );
                    } catch (error) {
                      console.error(`Batch insert error:`, error.message);

                      if (error.writeErrors) {
                        const successCount =
                          outletsToInsert.length - error.writeErrors.length;
                        totalInserted += successCount;

                        // Add failed records to skipped
                        error.writeErrors.forEach((writeError) => {
                          const failedOutlet =
                            outletsToInsert[writeError.index];
                          skippedRows.push({
                            ...failedOutlet,
                            reason: `Insert error: ${writeError.errmsg}`,
                            index: writeError.index + 1,
                          });
                          totalSkipped++;
                        });
                      } else {
                        // Complete failure
                        outletsToInsert.forEach((outlet, index) => {
                          skippedRows.push({
                            ...outlet,
                            reason: `Insert error: ${error.message}`,
                            index: index + 1,
                          });
                          totalSkipped++;
                        });
                      }
                    }
                  }

                  // Progress logging
                  const progress = (
                    ((batchStart + batch.length) / results.length) * 100
                  ).toFixed(1);
                  console.log(
                    `Batch completed. Progress: ${progress}% (${totalProcessed}/${results.length} processed, ${totalInserted} inserted, ${totalSkipped} skipped)`
                  );

                  // Optional delay
                  if (batchStart + BATCH_SIZE < results.length) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }
                }

                console.log("\n=== OUTLET BULK UPLOAD SUMMARY ===");
                console.log(`Total Processed: ${totalProcessed}`);
                console.log(`Successfully Inserted: ${totalInserted}`);
                console.log(`Skipped/Failed: ${totalSkipped}`);
                console.log(
                  `Success Rate: ${((totalInserted / totalProcessed) * 100).toFixed(2)}%`
                );

                // Set resp if nothing was inserted
                if (!resp) resp = [];
              } catch (error) {
                console.error(
                  "Critical error during outlet processing:",
                  error
                );
                throw error;
              }

              break;
            }

            case "beat": {
              console.log("Processing Beat CSV");

              const skippedRowsForBeat = [];
              const regionCodes = new Set();
              const distributorCodes = new Set();
              const beatNames = new Set();

              results.forEach((row) => {
                if (row["Region Code"]?.trim()) {
                  regionCodes.add(row["Region Code"].trim());
                }
                if (row["Distributor Codes"]?.trim()) {
                  // Split comma-separated distributor codes and add each one
                  const codes = row["Distributor Codes"].trim().split(",");
                  codes.forEach((code) => {
                    if (code.trim()) {
                      distributorCodes.add(code.trim());
                    }
                  });
                }
                if (row["Beat Name"]?.trim()) {
                  beatNames.add(row["Beat Name"].trim());
                }
              }); // Step 2: Batch fetch regions, distributors, and existing beats
              const [regions, distributors, existingBeats] = await Promise.all([
                Region.find({ code: { $in: Array.from(regionCodes) } }).lean(),
                Distributor.find({
                  dbCode: { $in: Array.from(distributorCodes) },
                }).lean(),
                Beat.find({ name: { $in: Array.from(beatNames) } })
                  .select("name regionId distributorId")
                  .lean(),
              ]); // Step 3: Create lookup maps
              const regionMap = new Map(regions.map((r) => [r.code, r]));
              const distributorMap = new Map(
                distributors.map((d) => [d.dbCode, d])
              );

              // Create a map for existing beat combinations (name + regionId)
              // Since distributorId is now an array, we'll check differently
              const existingBeatsByNameAndRegion = new Map();
              existingBeats.forEach((beat) => {
                const key = `${beat.name}_${beat.regionId}`;
                if (!existingBeatsByNameAndRegion.has(key)) {
                  existingBeatsByNameAndRegion.set(key, []);
                }
                existingBeatsByNameAndRegion.get(key).push(beat);
              });

              console.log(
                `Found ${regions.length} regions and ${distributors.length} distributors in database`
              );
              console.log(
                `Found ${existingBeats.length} existing beats with matching names`
              );

              // Step 4: First pass - validate all rows
              const validRowsForProcessing = [];
              const processedBeatCombinations = new Set(); // Track name+region+distributor combinations within current CSV

              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                row.index = i + 1;

                // Validate required fields (removed Beat Code validation)
                if (!row["Beat Name"]?.trim()) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Missing Beat Name at row ${row.index}`,
                  });
                  continue;
                }

                if (!row["Beat Type"]?.trim()) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Missing Beat Type at row ${row.index}`,
                  });
                  continue;
                }

                if (!row["Region Code"]?.trim()) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Missing Region Code at row ${row.index}`,
                  });
                  continue;
                }

                if (!row["Distributor Codes"]?.trim()) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Missing Distributor Codes at row ${row.index}`,
                  });
                  continue;
                }

                const beatName = row["Beat Name"].trim();
                const beatType = row["Beat Type"].trim().toLowerCase();
                const regionCode = row["Region Code"].trim();
                const distributorCodesStr = row["Distributor Codes"].trim();

                // Parse comma-separated distributor codes
                const distributorCodes = distributorCodesStr
                  .split(",")
                  .map((code) => code.trim())
                  .filter((code) => code.length > 0);

                // Parse comma-separated beat IDs (optional field)
                let beatIds = [];
                if (row["Beat IDs"]?.trim()) {
                  beatIds = row["Beat IDs"]
                    .trim()
                    .split(",")
                    .map((id) => id.trim())
                    .filter((id) => id.length > 0);
                }

                if (distributorCodes.length === 0) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `No valid distributor codes found in "${distributorCodesStr}" at row ${row.index}`,
                  });
                  continue;
                } // Validate beat type
                if (!["split", "normal"].includes(beatType)) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Invalid Beat Type "${beatType}" at row ${row.index}. Must be "split" or "normal"`,
                  });
                  continue;
                }

                // Validate region exists
                const region = regionMap.get(regionCode);
                if (!region) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Region with code "${regionCode}" not found at row ${row.index}`,
                  });
                  continue;
                }

                // Validate region name matches (if provided)
                if (
                  row["Region Name"]?.trim() &&
                  row["Region Name"].trim() !== region.name
                ) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Region name mismatch at row ${row.index
                      }. Expected "${region.name}", got "${row[
                        "Region Name"
                      ].trim()}"`,
                  });
                  continue;
                }

                // Validate distributors exist and collect valid ones
                const validDistributors = [];
                const invalidDistributorCodes = [];

                for (const distributorCode of distributorCodes) {
                  const distributor = distributorMap.get(distributorCode);
                  if (!distributor) {
                    invalidDistributorCodes.push(distributorCode);
                  } else {
                    // Validate that distributor belongs to the same region
                    if (
                      distributor.regionId.toString() !== region._id.toString()
                    ) {
                      skippedRowsForBeat.push({
                        ...row,
                        reason: `Distributor "${distributor.name}" (${distributorCode}) does not belong to region "${region.name}" at row ${row.index}`,
                      });
                      continue; // Skip this entire row
                    }
                    validDistributors.push(distributor);
                  }
                }

                if (invalidDistributorCodes.length > 0) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Distributor codes not found: ${invalidDistributorCodes.join(
                      ", "
                    )} at row ${row.index}`,
                  });
                  continue;
                }

                if (validDistributors.length === 0) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `No valid distributors found for region "${region.name}" at row ${row.index}`,
                  });
                  continue;
                }

                // Create unique combination key for beat validation
                const beatNameRegionKey = `${beatName}_${region._id}`;

                // Check for existing beat with same name and region that already includes any of these distributors
                const existingBeatsForNameRegion =
                  existingBeatsByNameAndRegion.get(beatNameRegionKey);
                if (existingBeatsForNameRegion) {
                  const conflictingDistributors = [];
                  validDistributors.forEach((distributor) => {
                    const beatWithDistributor = existingBeatsForNameRegion.find(
                      (beat) =>
                        beat.distributorId &&
                        beat.distributorId.includes(distributor._id.toString())
                    );
                    if (beatWithDistributor) {
                      conflictingDistributors.push(distributor.name);
                    }
                  });

                  if (conflictingDistributors.length > 0) {
                    skippedRowsForBeat.push({
                      ...row,
                      reason: `Beat with name "${beatName}" already includes distributors: ${conflictingDistributors.join(
                        ", "
                      )} in region "${region.name}" at row ${row.index}`,
                    });
                    continue;
                  }
                }

                // Check for duplicate beat combinations within CSV
                const duplicateDistributors = [];
                validDistributors.forEach((distributor) => {
                  const beatCombinationKey = `${beatName}_${region._id}_${distributor._id}`;
                  if (processedBeatCombinations.has(beatCombinationKey)) {
                    duplicateDistributors.push(distributor.name);
                  } else {
                    processedBeatCombinations.add(beatCombinationKey);
                  }
                });

                if (duplicateDistributors.length > 0) {
                  skippedRowsForBeat.push({
                    ...row,
                    reason: `Duplicate beat combination "${beatName}" for distributors: ${duplicateDistributors.join(
                      ", "
                    )} in region "${region.name}" in CSV at row ${row.index}`,
                  });
                  continue;
                }

                // Store validated row data
                validRowsForProcessing.push({
                  row,
                  beatName,
                  beatType,
                  region,
                  distributors: validDistributors,
                  beatIds: beatIds, // Add beatIds to validated row data
                });
              }

              console.log(
                `Processing ${validRowsForProcessing.length} valid beats out of ${results.length} total rows`
              );
              console.log(
                `Skipped ${skippedRowsForBeat.length} rows due to validation errors`
              );

              // Step 5: Generate beat codes in batch and create beat documents
              let insertedBeats = [];
              if (validRowsForProcessing.length > 0) {
                try {
                  // Generate beat codes in batch
                  const beatCodes = await generateCodesInBatch(
                    "BEAT",
                    validRowsForProcessing.length
                  );
                  console.log(`Generated ${beatCodes.length} beat codes`);

                  // Create beat documents with generated codes
                  const beatDocs = validRowsForProcessing.map(
                    (validRow, index) => ({
                      name: validRow.beatName,
                      code: beatCodes[index],
                      beatIds: validRow.beatIds || [], // Add beatIds field
                      beat_type: validRow.beatType,
                      regionId: validRow.region._id,
                      distributorId: validRow.distributors.map((d) => d._id),
                      status: true,
                    })
                  );

                  // Insert beats
                  insertedBeats = await Beat.insertMany(beatDocs);
                  console.log(
                    `Successfully inserted ${insertedBeats.length} beats`
                  );
                } catch (insertError) {
                  console.error("Error inserting beats:", insertError);

                  // Handle duplicate key errors or other insertion errors
                  if (insertError.code === 11000) {
                    const duplicateKey = Object.keys(insertError.keyValue)[0];
                    const duplicateValue = insertError.keyValue[duplicateKey];
                    throw new Error(
                      `Duplicate ${duplicateKey}: ${duplicateValue}. This beat may have been created by another process.`
                    );
                  }

                  throw new Error(
                    `Failed to insert beats: ${insertError.message}`
                  );
                }
              } else {
                console.log("No valid beats to insert");
              }

              resp = insertedBeats;
              skippedRows = skippedRowsForBeat;

              // Step 6: Log summary
              console.log(`Beat bulk upload completed:`);
              console.log(`- Total rows processed: ${results.length}`);
              console.log(`- Successfully inserted: ${insertedBeats.length}`);
              console.log(`- Skipped rows: ${skippedRowsForBeat.length}`);

              break;
            }

            case "employee": {
              console.log("Processing Employee CSV");

              // Batch processing configuration
              const BATCH_SIZE = 1000;
              let totalProcessed = 0;
              let totalInserted = 0;
              let totalSkipped = 0;

              try {
                // Step 1: Collect unique codes for batch DB queries
                const uniqueCodes = {
                  empIds: new Set(),
                  designations: new Set(),
                  states: new Set(),
                  brands: new Set(),
                  distributors: new Set(),
                  emails: new Set(),
                  rmEmpIds: new Set(),
                  rmDesignations: new Set(),
                };

                results?.forEach((row) => {
                  if (row["Employee ID"]?.trim())
                    uniqueCodes.empIds.add(row["Employee ID"].trim());
                  if (row["Designation Code"]?.trim())
                    uniqueCodes.designations.add(
                      row["Designation Code"].trim()
                    );
                  if (row["State Code"]?.trim())
                    uniqueCodes.states.add(row["State Code"].trim());
                  if (row["Brand Code"]?.trim()) {
                    // Split brand codes and add each individually
                    const brandCodes = row["Brand Code"]
                      .trim()
                      .split(",")
                      .map((code) => code.trim())
                      .filter(Boolean);
                    brandCodes.forEach((code) => {
                      uniqueCodes.brands.add(code);
                      // console.log(`Added brand code to uniqueCodes: ${code}`);
                    });
                  }
                  if (row["Distributor Code"]?.trim()) {
                    // Split distributor codes and add each individually
                    const codes = row["Distributor Code"]
                      .trim()
                      .split(",")
                      .map((code) => code.trim());
                    // console.log(`Processing distributor codes from CSV: ${codes.join(", ")}`);
                    codes.forEach((code) => {
                      uniqueCodes.distributors.add(code);
                      // console.log(`Added distributor code to uniqueCodes: ${code}`);
                    });
                  }
                  if (row["Email"]?.trim())
                    uniqueCodes.emails.add(row["Email"].trim().toLowerCase());
                  if (row["RM Employee ID"]?.trim())
                    uniqueCodes.rmEmpIds.add(row["RM Employee ID"].trim());
                  if (row["RM Designation Code"]?.trim())
                    uniqueCodes.rmDesignations.add(
                      row["RM Designation Code"].trim()
                    );
                });

                console.log(
                  `Found unique codes - EmpIds: ${uniqueCodes.empIds.size}, Designations: ${uniqueCodes.designations.size}, States: ${uniqueCodes.states.size}, Brands: ${uniqueCodes.brands.size}, Distributors: ${uniqueCodes.distributors.size}, Emails: ${uniqueCodes.emails.size}, RMEmpIds: ${uniqueCodes.rmEmpIds.size}, RMDesignations: ${uniqueCodes.rmDesignations.size}`
                );

                // Step 2: Batch fetch related entities
                console.log("Fetching related entities from database...");
                const [
                  existingEmployees,
                  designations,
                  statesWithRelations,
                  brands,
                  distributors,
                  existingEmails,
                  rmEmployees,
                  rmDesignations,
                ] = await Promise.all([
                  Employee.find({
                    empId: { $in: Array.from(uniqueCodes.empIds) },
                  })
                    .select("empId")
                    .lean(),
                  Designation.find({
                    code: { $in: Array.from(uniqueCodes.designations) },
                  })
                    .select("code _id name parent_desg")
                    .lean(),
                  State.find({ slug: { $in: Array.from(uniqueCodes.states) } })
                    .populate("zoneId", "_id name code")
                    .select("slug _id name code zoneId")
                    .lean(),
                  Brand.find({ code: { $in: Array.from(uniqueCodes.brands) } })
                    .select("code _id")
                    .lean(),
                  Distributor.find({
                    dbCode: { $in: Array.from(uniqueCodes.distributors) },
                  })
                    .select("dbCode _id")
                    .lean()
                    .then((results) => {
                      // console.log(`Found ${results.length} distributors in database`);
                      // console.log('Distributor codes found:', results.map(d => d.dbCode).join(', '));
                      return results;
                    }),
                  Employee.find({
                    email: { $in: Array.from(uniqueCodes.emails) },
                  })
                    .select("email")
                    .lean(),
                  Employee.find({
                    empId: { $in: Array.from(uniqueCodes.rmEmpIds) },
                  })
                    .select("empId _id desgId")
                    .lean(),
                  Designation.find({
                    code: { $in: Array.from(uniqueCodes.rmDesignations) },
                  })
                    .select("code _id name")
                    .lean(),
                ]);

                // Fetch regions for the states
                const stateIds = statesWithRelations.map((state) => state._id);
                const regions = await Region.find({
                  stateId: { $in: stateIds },
                })
                  .select("_id stateId")
                  .lean();

                // Step 3: Create lookup maps
                const lookupMaps = {
                  existingEmpIds: new Set(
                    existingEmployees.map((emp) => emp.empId)
                  ),
                  designations: new Map(
                    designations.map((desg) => [desg.code, desg])
                  ),
                  statesWithRelations: new Map(
                    statesWithRelations.map((state) => [
                      state.slug,
                      {
                        _id: state._id,
                        name: state.name,
                        code: state.code,
                        zoneId: state.zoneId?._id,
                        zoneName: state.zoneId?.name,
                        zoneCode: state.zoneId?.code,
                      },
                    ])
                  ),
                  regionsByStateId: new Map(
                    regions.map((region) => [
                      region.stateId.toString(),
                      region._id,
                    ])
                  ),
                  brands: new Map(
                    brands.map((brand) => [brand.code, brand._id])
                  ),
                  distributors: new Map(
                    distributors?.map((dist) => {
                      // console.log(`Creating distributor map entry: ${dist?.dbCode} -> ${dist?._id}`);
                      return [dist?.dbCode, dist?._id];
                    })
                  ),
                  existingEmails: new Set(
                    existingEmails.map((emp) => emp.email?.toLowerCase())
                  ),
                  rmEmployees: new Map(
                    rmEmployees.map((emp) => [emp.empId, emp])
                  ),
                  rmDesignations: new Map(
                    rmDesignations.map((desg) => [desg.code, desg])
                  ),
                };

                console.log(
                  `Lookup maps created - Designations: ${lookupMaps.designations.size}, States: ${lookupMaps.statesWithRelations.size}, Regions: ${lookupMaps.regionsByStateId.size}, Brands: ${lookupMaps.brands.size}, Distributors: ${lookupMaps.distributors.size}, RMEmployees: ${lookupMaps.rmEmployees.size}, RMDesignations: ${lookupMaps.rmDesignations.size}`
                );

                const skippedRowsForEmployee = [];

                // Step 4: Process in batches
                for (
                  let batchStart = 0;
                  batchStart < results.length;
                  batchStart += BATCH_SIZE
                ) {
                  const batchEnd = Math.min(
                    batchStart + BATCH_SIZE,
                    results.length
                  );
                  const batch = results.slice(batchStart, batchEnd);

                  console.log(
                    `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1
                    }: rows ${batchStart + 1}-${batchEnd}`
                  );

                  const employeesToInsert = [];

                  for (const row of batch) {
                    totalProcessed++;

                    try {
                      // Validate required fields
                      const empId = row["Employee ID"]?.trim();
                      const name = row["Employee Name"]?.trim();
                      const designationCode = row["Designation Code"]?.trim();

                      if (!empId) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: "Employee ID is required",
                        });
                        totalSkipped++;
                        continue;
                      }

                      if (!name) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: "Employee Name is required",
                        });
                        totalSkipped++;
                        continue;
                      }

                      if (!designationCode) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: "Designation Code is required",
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Check if employee already exists
                      if (lookupMaps.existingEmpIds.has(empId)) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: `Employee with ID '${empId}' already exists`,
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Validate designation
                      const designation =
                        lookupMaps.designations.get(designationCode);
                      if (!designation) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: `Designation with code '${designationCode}' not found`,
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Validate email uniqueness if provided
                      const email = row["Email"]?.trim()?.toLowerCase();
                      if (email && lookupMaps.existingEmails.has(email)) {
                        skippedRowsForEmployee.push({
                          ...row,
                          reason: `Employee with email '${email}' already exists`,
                        });
                        totalSkipped++;
                        continue;
                      }

                      // Validate reporting manager if provided
                      let reportingManagerId = null;
                      const rmEmpId = row["RM Employee ID"]?.trim();
                      const rmDesgCode = row["RM Designation Code"]?.trim();

                      if (rmEmpId || rmDesgCode) {
                        // If designation has parent_desg, RM fields are required
                        if (
                          designation.parent_desg &&
                          (!rmEmpId || !rmDesgCode)
                        ) {
                          skippedRowsForEmployee.push({
                            ...row,
                            reason: `Reporting Manager Employee ID and Designation Code are required for designation '${designationCode}'`,
                          });
                          totalSkipped++;
                          continue;
                        }

                        if (rmEmpId && rmDesgCode) {
                          // Validate RM employee exists
                          const rmEmployee =
                            lookupMaps.rmEmployees.get(rmEmpId);
                          if (!rmEmployee) {
                            skippedRowsForEmployee.push({
                              ...row,
                              reason: `Reporting Manager with Employee ID '${rmEmpId}' not found`,
                            });
                            totalSkipped++;
                            continue;
                          }

                          // Validate RM designation exists
                          const rmDesignation =
                            lookupMaps.rmDesignations.get(rmDesgCode);
                          if (!rmDesignation) {
                            skippedRowsForEmployee.push({
                              ...row,
                              reason: `Reporting Manager Designation with code '${rmDesgCode}' not found`,
                            });
                            totalSkipped++;
                            continue;
                          }

                          // Validate RM employee has the correct designation
                          if (
                            rmEmployee.desgId.toString() !==
                            rmDesignation._id.toString()
                          ) {
                            skippedRowsForEmployee.push({
                              ...row,
                              reason: `Reporting Manager '${rmEmpId}' does not have designation '${rmDesgCode}'`,
                            });
                            totalSkipped++;
                            continue;
                          }

                          reportingManagerId = rmEmployee._id;
                        }
                      }

                      // Get state and derive zone/region from it
                      const stateCode = row["State Code"]?.trim();
                      const brandCodes = row["Brand Code"]
                        ?.trim()
                        ?.split(",")
                        .map((code) => code.trim())
                        .filter(Boolean);
                      const distributorCodes = row["Distributor Code"]
                        ?.trim()
                        ?.split(",")
                        .map((code) => code?.trim())
                        .filter(Boolean);

                      // Validate state exists and get related zone/region
                      let stateId = null;
                      let zoneId = null;
                      let regionId = null;

                      if (stateCode) {
                        const stateInfo =
                          lookupMaps.statesWithRelations.get(stateCode);
                        if (stateInfo) {
                          stateId = stateInfo._id;
                          zoneId = stateInfo.zoneId;
                          regionId = lookupMaps.regionsByStateId.get(
                            stateId.toString()
                          );
                        } else {
                          skippedRowsForEmployee.push({
                            ...row,
                            reason: `State with code '${stateCode}' not found`,
                          });
                          totalSkipped++;
                          continue;
                        }
                      }

                      // Handle multiple brand codes with validation
                      const brandIds = [];
                      const invalidBrandCodes = [];

                      if (brandCodes?.length > 0) {
                        // console.log(`Processing brand codes for employee ${empId}: ${brandCodes.join(", ")}`);
                        // console.log(`Available brand codes in map: ${[...lookupMaps.brands.keys()].join(", ")}`);

                        for (const code of brandCodes) {
                          const brandId = lookupMaps.brands.get(code);
                          // console.log(`Checking brand code: ${code} -> ${brandId || 'not found'}`);

                          if (brandId) {
                            brandIds.push(brandId);
                          } else {
                            invalidBrandCodes.push(code);
                          }
                        }

                        // If any brand codes are invalid, skip the employee
                        if (invalidBrandCodes.length > 0) {
                          // console.log(`Invalid brand codes found: ${invalidBrandCodes.join(", ")}`);
                          skippedRowsForEmployee.push({
                            ...row,
                            reason: `Invalid Brand Code(s): ${invalidBrandCodes.join(
                              ", "
                            )}`,
                          });
                          totalSkipped++;
                          continue;
                        }
                      }

                      // Handle multiple distributor codes with validation
                      const distributorIds = [];
                      const invalidDistributorCodes = [];

                      if (distributorCodes?.length > 0) {
                        for (const code of distributorCodes) {
                          const distributorId =
                            lookupMaps?.distributors?.get(code);
                          if (distributorId) {
                            distributorIds?.push(distributorId);
                          } else {
                            invalidDistributorCodes.push(code);
                          }
                        }

                        // If any distributor codes are invalid, skip the employee
                        if (invalidDistributorCodes.length > 0) {
                          skippedRowsForEmployee.push({
                            ...row,
                            reason: `Invalid Distributor Code(s): ${invalidDistributorCodes.join(
                              ", "
                            )}`,
                          });
                          totalSkipped++;
                          continue;
                        }
                      }

                      // Parse dates
                      const parseDate = (dateStr) => {
                        if (!dateStr?.trim()) return null;
                        const date = moment(
                          dateStr.trim(),
                          [
                            "DD/MM/YYYY",
                            "MM/DD/YYYY",
                            "YYYY/MM/DD",
                            "YYYY-MM-DD",
                            "DD-MM-YYYY",
                            "MM-DD-YYYY",
                          ],
                          true
                        );
                        return date.isValid() ? date.toDate() : null;
                      };

                      const dob = parseDate(row["Date of Birth"]);
                      const joiningDate = parseDate(row["Joining Date"]);
                      const leavingDate = parseDate(row["Leaving Date"]);

                      // Generate password for employee
                      const generatedPassword = Math.random()
                        .toString(36)
                        .slice(-8);

                      // Create distributor mapping history for each distributor
                      const distributorMappingHistory = distributorIds.map(
                        (id) => ({
                          distributorId: id,
                          mappedDate: new Date(),
                          currentStatus: true,
                        })
                      );

                      // Prepare employee document
                      const employeeDoc = {
                        name,
                        empId,
                        password: generatedPassword,
                        desgId: designation._id,
                        zoneId,
                        regionId,
                        stateId,
                        brandId: brandIds.length > 0 ? brandIds : [],
                        distributorId: distributorIds, // Always provide the array, even if empty
                        distributorMappingHistory: distributorMappingHistory, // Always provide the array, even if empty
                        area: row["Area"]?.trim()
                          ? [row["Area"].trim()]
                          : undefined,
                        email: email || undefined,
                        employeeLabel:
                          row["Employee Label"]?.trim() || undefined,
                        phone: row["Phone"]?.trim() || undefined,
                        dob,
                        joiningDate,
                        leaving_date: leavingDate,
                        headquarter: row["Headquarter"]?.trim() || undefined,
                        tenure: row["Tenure"]?.trim()
                          ? parseInt(row["Tenure"].trim())
                          : undefined,
                        status:
                          row["Status"]?.trim()?.toLowerCase() !== "false",
                      };

                      // Remove undefined fields
                      Object.keys(employeeDoc).forEach((key) => {
                        if (employeeDoc[key] === undefined) {
                          delete employeeDoc[key];
                        }
                      });

                      employeesToInsert.push({
                        employeeDoc,
                        generatedPassword,
                        email: email || undefined,
                        reportingManagerId,
                      });

                      // Add email to existing emails set to prevent duplicates in the same batch
                      if (email) {
                        lookupMaps.existingEmails.add(email);
                      }
                      // Add empId to existing empIds set to prevent duplicates in the same batch
                      lookupMaps.existingEmpIds.add(empId);
                    } catch (error) {
                      console.error(
                        `Error processing employee row ${totalProcessed}:`,
                        error.message
                      );
                      skippedRowsForEmployee.push({
                        ...row,
                        reason: `Processing error: ${error.message}`,
                      });
                      totalSkipped++;
                    }
                  }

                  // Step 5: Bulk insert employees
                  if (employeesToInsert.length > 0) {
                    try {
                      const employeeDocs = employeesToInsert.map(
                        (item) => item.employeeDoc
                      );

                      const insertResult = await Employee.insertMany(
                        employeeDocs,
                        {
                          ordered: false,
                          writeConcern: { w: 1, j: false },
                        }
                      );

                      totalInserted += insertResult.length;
                      if (!resp) resp = [];
                      resp.push(...insertResult);

                      // Create password records for inserted employees
                      const passwordRecords = insertResult.map(
                        (employee, index) => ({
                          employeeId: employee._id,
                          genPassword:
                            employeesToInsert[index].generatedPassword,
                        })
                      );

                      await EmployeePassword.insertMany(passwordRecords, {
                        ordered: false,
                        writeConcern: { w: 1, j: false },
                      });

                      // Create employee mappings for those with reporting managers
                      const employeeMappings = [];
                      const employeeUpdates = [];

                      for (let i = 0; i < insertResult.length; i++) {
                        const employee = insertResult[i];
                        const employeeToInsert = employeesToInsert[i];

                        if (employeeToInsert.reportingManagerId) {
                          // Create employee mapping
                          const mapping = {
                            empId: employee._id,
                            rmEmpId: employeeToInsert.reportingManagerId,
                          };
                          employeeMappings.push(mapping);
                        }
                      }

                      // Insert employee mappings if any
                      if (employeeMappings.length > 0) {
                        const insertedMappings =
                          await EmployeeMapping.insertMany(employeeMappings, {
                            ordered: false,
                            writeConcern: { w: 1, j: false },
                          });

                        // Update employees with mapping IDs
                        for (let i = 0; i < insertedMappings.length; i++) {
                          const mapping = insertedMappings[i];
                          employeeUpdates.push({
                            updateOne: {
                              filter: { _id: mapping.empId },
                              update: { empMappingId: mapping._id },
                            },
                          });
                        }

                        if (employeeUpdates.length > 0) {
                          await Employee.bulkWrite(employeeUpdates);
                        }

                        console.log(
                          `Created ${insertedMappings.length} employee mappings`
                        );
                      }

                      console.log(
                        `Batch inserted: ${insertResult.length} employees with passwords (Total: ${totalInserted})`
                      );
                    } catch (error) {
                      console.error(`Batch insert error:`, error.message);

                      // Handle individual insertion failures
                      if (error.writeErrors) {
                        const failedCount = error.writeErrors.length;
                        const successCount =
                          employeesToInsert.length - failedCount;
                        totalInserted += successCount;
                        totalSkipped += failedCount;

                        error.writeErrors.forEach((writeError, index) => {
                          skippedRowsForEmployee.push({
                            ...batch[index],
                            reason: `Database error: ${writeError.errmsg}`,
                          });
                        });

                        console.log(
                          `Partial batch insert: ${successCount} succeeded, ${failedCount} failed`
                        );
                      } else {
                        totalSkipped += employeesToInsert.length;
                        console.error(
                          `Full batch failed: ${employeesToInsert.length} employees`
                        );
                      }
                    }
                  }

                  // Optional: Add small delay to prevent overwhelming the database
                  if (batchStart + BATCH_SIZE < results.length) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }
                }

                console.log(`\n=== EMPLOYEE BULK UPLOAD SUMMARY ===`);
                console.log(`Total Processed: ${totalProcessed}`);
                console.log(`Successfully Inserted: ${totalInserted}`);
                console.log(`Skipped/Failed: ${totalSkipped}`);
                console.log(
                  `Success Rate: ${(
                    (totalInserted / totalProcessed) *
                    100
                  ).toFixed(2)}%`
                );

                // Set resp and skippedRows
                if (!resp) resp = [];
                skippedRows = skippedRowsForEmployee;
              } catch (error) {
                console.error(
                  "Critical error during employee processing:",
                  error
                );
                throw error;
              }

              break;
            }

            case "employeeBeatMapping": {
              console.log("Processing Employee Beat Mapping CSV");

              try {
                let totalProcessed = 0;
                let totalMapped = 0;
                let totalSkipped = 0;

                // 1. Collect unique employee IDs and beat codes for batch DB queries
                const employeeIds = new Set();
                const beatCodes = new Set();

                for (const row of results) {
                  if (row["Employee ID"]) {
                    employeeIds.add(row["Employee ID"].trim());
                  }
                  if (row["Beat Codes"]) {
                    // Parse comma-separated beat codes (remove quotes if present)
                    const codes = row["Beat Codes"]
                      .replace(/"/g, "")
                      .split(",")
                      .map((code) => code.trim())
                      .filter((code) => code);
                    codes.forEach((code) => beatCodes.add(code));
                  }
                }

                // 2. Fetch all required employees and beats in parallel with detailed information
                const [employees, beats] = await Promise.all([
                  Employee.find({ empId: { $in: Array.from(employeeIds) } })
                    .select("empId _id beatId distributorId")
                    .lean(),
                  Beat.find({ code: { $in: Array.from(beatCodes) } })
                    .select(
                      "code _id employeeId beat_type distributorId isOccupied"
                    )
                    .lean(),
                ]);

                // 3. Create lookup maps for quick access
                const employeeMap = new Map(
                  employees.map((emp) => [emp.empId.trim(), emp])
                );
                const beatMap = new Map(
                  beats.map((beat) => [beat.code.trim(), beat])
                );

                // 4. Process each row with comprehensive validation
                const employeeUpdates = [];
                const beatUpdates = [];

                for (let i = 0; i < results.length; i++) {
                  const row = results[i];
                  totalProcessed++;

                  try {
                    // Validate required fields
                    if (!row["Employee ID"] || !row["Beat Codes"]) {
                      skippedRows.push({
                        row: i + 1,
                        employeeId: row["Employee ID"] || "N/A",
                        beatCodes: row["Beat Codes"] || "N/A",
                        reason: "Missing Employee ID or Beat Codes",
                      });
                      totalSkipped++;
                      continue;
                    }

                    const employeeId = row["Employee ID"].trim();
                    const employee = employeeMap.get(employeeId);

                    if (!employee) {
                      skippedRows.push({
                        row: i + 1,
                        employeeId: employeeId,
                        beatCodes: row["Beat Codes"],
                        reason: `Employee with ID ${employeeId} not found`,
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Parse beat codes
                    const beatCodes = row["Beat Codes"]
                      .replace(/"/g, "")
                      .split(",")
                      .map((code) => code.trim())
                      .filter((code) => code);

                    let rowHasErrors = false;
                    let errorMessages = [];
                    const validBeatIds = [];

                    // Validate all beats in the row first
                    for (const beatCode of beatCodes) {
                      const beat = beatMap.get(beatCode);

                      if (!beat) {
                        errorMessages.push(
                          `Beat with code ${beatCode} not found`
                        );
                        rowHasErrors = true;
                        continue;
                      }

                      // Check if beat is already assigned to this employee
                      const employeeBeatIds = employee.beatId || [];
                      const isAlreadyAssigned = employeeBeatIds.some(
                        (beatId) => beatId.toString() === beat._id.toString()
                      );

                      if (isAlreadyAssigned) {
                        errorMessages.push(
                          `Beat ${beatCode} is already assigned to employee ${employeeId}`
                        );
                        rowHasErrors = true;
                        continue;
                      }

                      // Beat type specific validation
                      if (beat.beat_type === "normal") {
                        // For normal beats: Check if already occupied by another employee
                        if (
                          beat.isOccupied &&
                          beat.employeeId &&
                          beat.employeeId.length > 0
                        ) {
                          // Check if any of the assigned employees is different from current employee
                          const hasOtherEmployee = beat.employeeId.some(
                            (empId) =>
                              empId.toString() !== employee._id.toString()
                          );

                          if (hasOtherEmployee) {
                            errorMessages.push(
                              `Normal beat ${beatCode} is already occupied by another employee`
                            );
                            rowHasErrors = true;
                            continue;
                          }
                        }

                        // Check distributor overlap for normal beats
                        const employeeDistributors =
                          employee.distributorId || [];
                        const beatDistributors = beat.distributorId || [];

                        const hasCommonDistributor = employeeDistributors.some(
                          (empDistId) =>
                            beatDistributors.some(
                              (beatDistId) =>
                                empDistId.toString() === beatDistId.toString()
                            )
                        );

                        if (!hasCommonDistributor) {
                          errorMessages.push(
                            `Employee ${employeeId} and normal beat ${beatCode} do not share any common distributors`
                          );
                          rowHasErrors = true;
                          continue;
                        }
                      } else if (beat.beat_type === "split") {
                        // For split beats: Only check distributor overlap (can be shared by multiple employees)
                        const employeeDistributors =
                          employee.distributorId || [];
                        const beatDistributors = beat.distributorId || [];

                        const hasCommonDistributor = employeeDistributors.some(
                          (empDistId) =>
                            beatDistributors.some(
                              (beatDistId) =>
                                empDistId.toString() === beatDistId.toString()
                            )
                        );

                        if (!hasCommonDistributor) {
                          errorMessages.push(
                            `Employee ${employeeId} and split beat ${beatCode} do not share any common distributors`
                          );
                          rowHasErrors = true;
                          continue;
                        }
                      } else {
                        errorMessages.push(
                          `Beat ${beatCode} has invalid beat type: ${beat.beat_type}`
                        );
                        rowHasErrors = true;
                        continue;
                      }

                      // If we reach here, the beat is valid for this employee
                      validBeatIds.push(beat._id);
                    }

                    // Skip the entire row if any beat has validation errors
                    if (rowHasErrors) {
                      skippedRows.push({
                        row: i + 1,
                        employeeId: employeeId,
                        beatCodes: row["Beat Codes"],
                        reason: errorMessages.join("; "),
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Skip if no valid beats found (shouldn't happen if validation is correct)
                    if (validBeatIds.length === 0) {
                      skippedRows.push({
                        row: i + 1,
                        employeeId: employeeId,
                        beatCodes: row["Beat Codes"],
                        reason: "No valid beats found after validation",
                      });
                      totalSkipped++;
                      continue;
                    }

                    // Prepare employee update (replace existing beatId array with new ones)
                    employeeUpdates.push({
                      updateOne: {
                        filter: { _id: employee._id },
                        update: {
                          $set: { beatId: validBeatIds },
                        },
                      },
                    });

                    // Prepare beat updates (add employee to each beat's employeeId array)
                    for (const beatId of validBeatIds) {
                      beatUpdates.push({
                        updateOne: {
                          filter: { _id: beatId },
                          update: {
                            $addToSet: { employeeId: employee._id },
                            $set: { isOccupied: true },
                          },
                        },
                      });
                    }

                    totalMapped++;
                  } catch (rowError) {
                    console.error(`Error processing row ${i + 1}:`, rowError);
                    skippedRows.push({
                      row: i + 1,
                      employeeId: row["Employee ID"] || "N/A",
                      beatCodes: row["Beat Codes"] || "N/A",
                      reason: `Processing error: ${rowError.message}`,
                    });
                    totalSkipped++;
                  }
                }

                // 5. Execute bulk operations
                if (employeeUpdates.length > 0) {
                  await Employee.bulkWrite(employeeUpdates, { ordered: false });
                }

                if (beatUpdates.length > 0) {
                  await Beat.bulkWrite(beatUpdates, { ordered: false });
                }

                console.log(`Employee Beat Mapping completed:
                  - Total processed: ${totalProcessed}
                  - Successfully mapped: ${totalMapped}
                  - Skipped: ${totalSkipped}`);

                resp = {
                  totalProcessed,
                  totalMapped,
                  totalSkipped,
                  message: "Employee beat mapping completed successfully",
                };
              } catch (error) {
                console.error("Error in employee beat mapping:", error);
                return res.status(500).send({
                  error: true,
                  message: "Error processing employee beat mapping",
                  details: error.message,
                });
              }

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
    console.error("Server Error:", error);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { saveCsvToDB };