const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Category = require("../../models/category.model");
const Brand = require("../../models/brand.model");
const Collection = require("../../models/collection.model");
const Product = require("../../models/product.model");
const SubBrand = require("../../models/subBrand.model");
const Supplier = require("../../models/supplier.model");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const fs = require("fs");
const path = require("path");

const syncProductMaster = asyncHandler(async (req, res) => {
  console.log("syncProductMaster: Started");

  if (!(await acquireLock("syncProductMaster"))) {
    console.log(
      "syncProductMaster: Lock not acquired, another sync in progress",
    );
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }

  try {

    // temp change 
    // Date handling
    let currentDate = new Date();
    currentDate = currentDate.toISOString().split("T")[0];
    currentDate = currentDate.split("-");
    currentDate = `${currentDate[2]}.${currentDate[1]}.${currentDate[0]}`;

    let previousDate = new Date();
    previousDate = previousDate.toISOString().split("T")[0];
    previousDate = previousDate.split("-");
    previousDate = `${previousDate[2]}.${previousDate[1]}.${previousDate[0]}`;

// let currentDate = "16.02.2026"; 
// let previousDate = "16.01.2026";    

    if (req.query.previousDate && req.query.currentDate) {
      if (new Date(req.query.previousDate) > new Date(req.query.currentDate)) {
        console.log("syncProductMaster: Invalid date range");
        res.status(400);
        throw new Error("Previous date cannot be greater than current date");
      } else {
        currentDate = req.query.currentDate;
        previousDate = req.query.previousDate;
      }
    }
    console.log("syncProductMaster: Date range", { previousDate, currentDate });

    // Fetch data from SAP API

    const response = await axios.get(
      `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_DMS_PRODUCT_MASTER_SRV/headerSet?sap-client=100&$filter=fromDate eq '${previousDate}' and toDate eq '${currentDate}' and variant eq ''&$format=json`,
      {
        headers: {
          Cookie: "sap-usercontext=sap-client=100",
        },
      },
    );

    let data = response?.data?.d?.results || [];
    console.log("🔍 EAN11 DEBUG - First 2 SAP records:");
    console.log(JSON.stringify(data.slice(0, 2), null, 2));
    console.log("🔍 EAN11 in first record:", data[0]?.ean11);

    // let data = [];
    // try {
    //   const filePath = path.join(
    //     __dirname,
    //     "../../script/04_Scripts/01_Product_Master_Download/reports/unique_products_2025-08-04T09-31-15-286Z.json"
    //   );
    //   console.log("syncProductMaster: Attempting to read file:", filePath);
    //   const fileContent = fs.readFileSync(filePath, "utf8");
    //   data = JSON.parse(fileContent);
    //   console.log(
    //     "syncProductMaster: File read and parsed, data length:",
    //     data.length
    //   );
    // } catch (err) {
    //   console.error("syncProductMaster: File read/parse error:", err);
    //   return res.status(500).json({
    //     success: false,
    //     message: "Failed to read or parse the file.json",
    //     error: err.message,
    //     stack: err.stack,
    //   });
    // }

    if (!data || data.length === 0) {
      console.log("syncProductMaster: No data found in file");
      res.status(404);
      throw new Error("No data found");
    }

    console.log(
      `[syncProductMaster] ⏳ Fetched ${data.length} records from SAP API/file`,
    );

    // Filter for unique variants (latest record per variant)
    const uniqueVariants = new Set();
    data = data.filter((item) => {
      const variant = item.variant || "";
      if (uniqueVariants.has(variant)) {
        return false;
      }
      uniqueVariants.add(variant);
      return true;
    });
    console.log(
      `syncProductMaster: Filtered to ${data.length} unique variants`,
    );

    // Helper functions
    const getUOM = (item) => {
      let UOM = "pcs";
      if (item?.sales_unit && item?.sales_unit?.trim() !== "") {
        const su = item.sales_unit.trim();
        if (su === "BOX") UOM = "box";
        else if (su === "DZ") UOM = "dz";
        else if (["1PA", "2PA", "3PA", "PAA", "PAK"].includes(su)) UOM = su;
      }
      return UOM;
    };

    const getPcsInBox = (item) => {
      let pcsInBox = item?.sales_conv ? item?.sales_conv : "1";
      pcsInBox = Number(pcsInBox.replace(/[^0-9.]/g, ""));
      const result = isNaN(pcsInBox)
        ? "1"
        : pcsInBox > 0
          ? pcsInBox.toString()
          : "1";
      return result;
    };

    const getBasePoints = (item) => {
      let basePoints = item.points || "";
      basePoints = basePoints.trim();
      basePoints = parseFloat(basePoints.replace(/[^0-9.]/g, ""));
      return isNaN(basePoints) ? "0" : basePoints.toString();
    };

    const getGst = (item) => {
      let cgst = Number(item?.cgst) || 0;
      let sgst = Number(item?.sgst) || 0;
      let igst = Number(item?.igst) || 0;
      if (igst > 0 && (cgst === 0 || sgst === 0)) {
        cgst = sgst = igst / 2;
      } else if (igst === 0 && (cgst > 0 || sgst > 0)) {
        if (cgst > 0 && sgst === 0) sgst = cgst;
        else if (sgst > 0 && cgst === 0) cgst = sgst;
        igst = cgst * 2;
      }
      return {
        cgst: cgst.toString(),
        sgst: sgst.toString(),
        igst: igst.toString(),
      };
    };

    const getSupplierCode = (item) => {
      let supplierCode = item?.manufacturer || "";
      let plantCode = item?.plant || "";
      if (supplierCode && supplierCode.trim() !== "") {
        return supplierCode.trim();
      } else if (plantCode && plantCode.trim() !== "") {
        return "C" + plantCode.trim();
      }
      return "";
    };

    // Transform the data
    console.log("syncProductMaster: Transforming data...");
    const transformedData = data.map((item) => ({
      "Product Code": item?.variant || "",
      "Product Name": item?.description || "",
      "SKU Group Code": item?.base || "",
      "SKU Group Name": item?.base_desc || "",
      "Product Size": item?.size || "",
      "Product Color": item?.color || "",
      "Product Pack": item?.pack || "",
      "Supplier Code": getSupplierCode(item),
      "Brand Code": item?.brand || "",
      "Sub Brand Code": item?.sub_brand || "",
      "Collection Code": item?.mat_grp || "",
      "Category Code": item?.mat_grp || "",
      "Product Type": item?.prdct_grp2 || "",
      "Valuation Type": item?.valuation_type || "",
      "Product HSN Code": item.hsn || "",
      CGST: getGst(item)?.cgst,
      SGST: getGst(item)?.sgst,
      IGST: getGst(item)?.igst,
      "Unit of Measure": getUOM(item),
      "Pieces in a box": getPcsInBox(item),
      "Base Points": getBasePoints(item),
      EAN11: item?.ean11 || "",
    }));
    console.log(
      "syncProductMaster: Data transformed, total records:",
      transformedData.length,
    );

    console.log("🔍 EAN11 DEBUG - First 2 transformed records:");
    console.log(JSON.stringify(transformedData.slice(0, 2), null, 2));
    console.log("🔍 Transformed EAN11:", transformedData[0]?.["EAN11"]);

    // Batch sizes
    const BATCH_SIZE = 5000;
    const DB_BATCH_SIZE = 1000;

    let totalProcessed = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let skippedRows = [];

    // Step 1: Extract unique codes efficiently
    const uniqueCodes = {
      categories: new Set(),
      collections: new Set(),
      brands: new Set(),
      subBrands: new Set(),
      products: new Set(),
    };

    transformedData.forEach((row) => {
      if (row["Category Code"]?.trim())
        uniqueCodes.categories.add(row["Category Code"].trim());
      if (row["Collection Code"]?.trim())
        uniqueCodes.collections.add(row["Collection Code"].trim());
      if (row["Brand Code"]?.trim())
        uniqueCodes.brands.add(row["Brand Code"].trim());
      if (row["Sub Brand Code"]?.trim())
        uniqueCodes.subBrands.add(row["Sub Brand Code"].trim());
      if (row["Product Code"]?.trim())
        uniqueCodes.products.add(row["Product Code"].trim());
    });
    console.log("syncProductMaster: Unique codes extracted", {
      categories: uniqueCodes.categories.size,
      collections: uniqueCodes.collections.size,
      brands: uniqueCodes.brands.size,
      subBrands: uniqueCodes.subBrands.size,
      products: uniqueCodes.products.size,
    });

    // Step 2: Extract unique supplier codes
    const uniqueSupplierCodes = new Set();
    transformedData.forEach((row) => {
      if (row["Supplier Code"]?.trim()) {
        uniqueSupplierCodes.add(row["Supplier Code"].trim());
      }
    });
    console.log(
      "syncProductMaster: Unique supplier codes extracted:",
      uniqueSupplierCodes.size,
    );

    // Step 3: Batch fetch related entities with proper indexing using codes
    console.log("syncProductMaster: Fetching related entities from DB...");
    const [
      categories,
      collections,
      brands,
      subBrands,
      suppliers,
      existingProducts,
    ] = await Promise.all([
      Category.find({ code: { $in: Array.from(uniqueCodes.categories) } })
        .select("code _id")
        .lean(),
      Collection.find({ code: { $in: Array.from(uniqueCodes.collections) } })
        .select("code _id cat_id")
        .lean(),
      Brand.find({ code: { $in: Array.from(uniqueCodes.brands) } })
        .select("code _id")
        .lean(),
      SubBrand.find({ code: { $in: Array.from(uniqueCodes.subBrands) } })
        .select("code _id")
        .lean(),
      Supplier.find({ supplierCode: { $in: Array.from(uniqueSupplierCodes) } })
        .select("supplierCode _id")
        .lean(),
      Product.find({ product_code: { $in: Array.from(uniqueCodes.products) } })
        .select("product_code")
        .lean(),
    ]);
    console.log("syncProductMaster: Related entities fetched", {
      categories: categories.length,
      collections: collections.length,
      brands: brands.length,
      subBrands: subBrands.length,
      suppliers: suppliers.length,
      existingProducts: existingProducts.length,
    });

    // Create lookup maps for quick access using codes
    const categoryMap = new Map(categories.map((c) => [c.code, c._id]));
    const collectionMap = new Map(collections.map((c) => [c.code, c._id]));
    const brandMap = new Map(brands.map((b) => [b.code, b._id]));
    const subBrandMap = new Map(subBrands.map((sb) => [sb.code, sb._id]));
    const supplierMap = new Map(suppliers.map((s) => [s.supplierCode, s._id]));
    const existingProductCodes = new Set(
      existingProducts.map((p) => p.product_code),
    );

    // Step 4: Process in batches
    for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
      const batch = transformedData.slice(i, i + BATCH_SIZE);
      console.log(
        `syncProductMaster: Processing batch ${i / BATCH_SIZE + 1} (${
          batch.length
        } records)`,
      );

      const validProducts = [];
      const productsToUpdate = [];
      const batchSkipped = [];

      for (const [index, row] of batch.entries()) {
        const rowIndex = i + index + 1;
        row.index = rowIndex;

        try {
          // Validate all required fields
          const missingFields = [];
          if (!row["Product Code"]?.trim()) missingFields.push("Product Code");
          if (!row["Product Name"]?.trim()) missingFields.push("Product Name");
          if (!row["SKU Group Code"]?.trim())
            missingFields.push("SKU Group Code");
          if (!row["SKU Group Name"]?.trim())
            missingFields.push("SKU Group Name");
          if (!row["Category Code"]?.trim())
            missingFields.push("Category Code");
          if (!row["Collection Code"]?.trim())
            missingFields.push("Collection Code");
          if (!row["Brand Code"]?.trim()) missingFields.push("Brand Code");
          if (!row["Supplier Code"]?.trim())
            missingFields.push("Supplier Code");

          if (missingFields.length > 0) {
            batchSkipped.push({
              ...row,
              index: rowIndex,
              reason: `Missing required field(s): ${missingFields.join(", ")}`,
            });
            console.log(
              `syncProductMaster: Skipped row ${rowIndex} - missing fields: ${missingFields.join(
                ", ",
              )}`,
            );
            continue;
          }

          const productCode = row["Product Code"].trim();
          const isExistingProduct = existingProductCodes.has(productCode);

          // Get references
          const categoryId = categoryMap.get(row["Category Code"]?.trim());
          const collectionId = collectionMap.get(
            row["Collection Code"]?.trim(),
          );
          const brandId = brandMap.get(row["Brand Code"]?.trim());
          const subBrandId = subBrandMap.get(row["Sub Brand Code"]?.trim());
          const supplierId = supplierMap.get(row["Supplier Code"]?.trim());

          const missingReferences = [];
          if (!categoryId)
            missingReferences.push(
              `Category not found with code: ${
                row["Category Code"]?.trim() || "N/A"
              }`,
            );
          if (!collectionId)
            missingReferences.push(
              `Collection not found with code: ${
                row["Collection Code"]?.trim() || "N/A"
              }`,
            );
          if (!brandId)
            missingReferences.push(
              `Brand not found with code: ${row["Brand Code"]?.trim() || "N/A"}`,
            );
          if (!supplierId)
            missingReferences.push(
              `Supplier not found with code: ${
                row["Supplier Code"]?.trim() || "N/A"
              }`,
            );

          if (missingReferences.length > 0) {
            batchSkipped.push({
              ...row,
              index: rowIndex,
              reason: missingReferences.join("; "),
            });
            console.log(
              `syncProductMaster: Skipped row ${rowIndex} - missing references: ${missingReferences.join(
                "; ",
              )}`,
            );
            continue;
          }

          // Build product data
          const productData = {
            product_code: productCode,
            name: row["Product Name"].trim(),
            sku_group_id: row["SKU Group Code"].trim(),
            sku_group__name: row["SKU Group Name"].trim(),
            img_path: row["Image Path"] || "",
            cat_id: categoryId,
            collection_id: collectionId,
            brand: brandId,
            subBrand: subBrandId,
            supplier: supplierId,
            size: row["Product Size"]?.trim() || "",
            color: row["Product Color"]?.trim() || "",
            pack: row["Product Pack"]?.trim() || "",
            no_of_pieces_in_a_box: row["Pieces in a box"]?.toString() || "1",
            product_type: row["Product Type"]?.trim() || "inner_wear",
            product_valuation_type: row["Valuation Type"]?.trim() || "",
            product_hsn_code: row["Product HSN Code"]?.trim() || "",
            cgst: row["CGST"]?.toString() || "2.5",
            sgst: row["SGST"]?.toString() || "2.5",
            igst: row["IGST"]?.toString() || "5",
            sbu: row["SBU"]?.trim() || "",
            base_point: row["Base Points"]?.toString() || "0",
            uom: row["Unit of Measure"]?.trim() || "pcs",
            ean11: row["EAN11"]?.trim() || "",
          };

          console.log(`🔍 Row ${rowIndex} - Product Code: ${productCode}`);
          console.log(`🔍 Row ${rowIndex} - EAN11 from row: "${row["EAN11"]}"`);
          console.log(
            `🔍 Row ${rowIndex} - EAN11 in productData: "${productData.ean11}"`,
          );
          console.log(
            `🔍 Row ${rowIndex} - Is existing product: ${isExistingProduct}`,
          );

          if (isExistingProduct) {
            // For existing products, prepare update data
            productsToUpdate.push({
              filter: { product_code: productCode },
              update: {
                $set: {
                  name: productData.name,
                  supplier: productData.supplier,
                  brand: productData.brand,
                  subBrand: productData.subBrand,
                  cat_id: productData.cat_id,
                  collection_id: productData.collection_id,
                  product_hsn_code: productData.product_hsn_code,
                  sku_group_id: productData.sku_group_id,
                  sku_group__name: productData.sku_group__name,
                  size: productData.size,
                  color: productData.color,
                  pack: productData.pack,
                  no_of_pieces_in_a_box: productData.no_of_pieces_in_a_box,
                  product_type: productData.product_type,
                  product_valuation_type: productData.product_valuation_type,
                  cgst: productData.cgst,
                  sgst: productData.sgst,
                  igst: productData.igst,
                  base_point: productData.base_point,
                  uom: productData.uom,
                  ean11: productData.ean11,
                  status: true,
                  updatedAt: new Date(),
                },
              },
            });
          } else {
            // For new products, add to insert array
            validProducts.push(productData);
            existingProductCodes.add(productCode);
          }
        } catch (error) {
          batchSkipped.push({
            ...row,
            index: rowIndex,
            reason: `Processing error: ${error.message}`,
          });
          console.log(
            `syncProductMaster: Error processing row ${rowIndex}: ${error.message}`,
          );
        }
      }

      // Insert valid products in smaller batches
      if (validProducts.length > 0) {
        console.log(
          `syncProductMaster: Inserting ${validProducts.length} new products`,
        );
        for (let j = 0; j < validProducts.length; j += DB_BATCH_SIZE) {
          const dbBatch = validProducts.slice(j, j + DB_BATCH_SIZE);
          try {
            console.log("🔍 EAN11 DEBUG - First product to insert:");
            console.log(JSON.stringify(dbBatch[0], null, 2));
            console.log("🔍 ean11 value:", dbBatch[0]?.ean11);
            const result = await Product.insertMany(dbBatch, {
              ordered: false,
            });
            totalInserted += result.length;
            console.log(
              `syncProductMaster: Inserted ${result.length} products (batch ${
                j / DB_BATCH_SIZE + 1
              })`,
            );
          } catch (error) {
            dbBatch.forEach((product, idx) => {
              batchSkipped.push({
                "Product Code": product.product_code,
                "Product Name": product.name,
                "Supplier Code": product.supplier,
                "Product Color": product.color || "",
                index: i + j + idx + 1,
                reason: `Database insertion failed: ${error.message}`,
              });
            });
            console.log(
              `syncProductMaster: Error inserting products (batch ${
                j / DB_BATCH_SIZE + 1
              }): ${error.message}`,
            );
          }
        }
      }

      // Update existing products in smaller batches
      if (productsToUpdate.length > 0) {
        console.log(
          `syncProductMaster: Updating ${productsToUpdate.length} existing products`,
        );
        for (let j = 0; j < productsToUpdate.length; j += DB_BATCH_SIZE) {
          const updateBatch = productsToUpdate.slice(j, j + DB_BATCH_SIZE);
          try {
            const bulkOps = updateBatch.map(({ filter, update }) => ({
              updateOne: {
                filter,
                update,
                upsert: false,
              },
            }));

            console.log("🔍 EAN11 DEBUG - First 3 update operations:");
            console.log(
              JSON.stringify(
                updateBatch.slice(0, 3).map((op) => ({
                  productCode: op.filter.product_code,
                  ean11InUpdate: op.update.$set.ean11,
                })),
                null,
                2,
              ),
            );

            const result = await Product.bulkWrite(bulkOps, {
              ordered: false,
              timestamps: false,
            });
            totalUpdated += result.modifiedCount;

            console.log(`🔍 Updated ${result.modifiedCount} products`);

            // Add this verification query
            const verifyProduct = await Product.findOne({
              product_code: "RJNJNACDROP0242080",
            }).select("product_code ean11");
            console.log("🔍 Verified product from DB:", verifyProduct);
            console.log(
              `syncProductMaster: Updated ${
                result.modifiedCount
              } products (batch ${j / DB_BATCH_SIZE + 1})`,
            );
          } catch (error) {
            updateBatch.forEach((updateOp, idx) => {
              batchSkipped.push({
                "Product Code": updateOp.filter.product_code,
                index: i + j + idx + 1,
                reason: `Database update failed: ${error.message}`,
              });
            });
            console.log(
              `syncProductMaster: Error updating products (batch ${
                j / DB_BATCH_SIZE + 1
              }): ${error.message}`,
            );
          }
        }
      }

      totalProcessed += batch.length;
      totalSkipped += batchSkipped.length;
      skippedRows.push(...batchSkipped);

      console.log(
        `syncProductMaster: Batch summary: processed=${batch.length}, inserted=${validProducts.length}, updated=${productsToUpdate.length}, skipped=${batchSkipped.length}`,
      );
    }

    console.log("syncProductMaster: All batches processed");
    console.log(
      "syncProductMaster: Final summary",
      JSON.stringify(
        {
          totalProcessed,
          totalInserted,
          totalUpdated,
          totalSkipped,
        },
        null,
        2,
      ),
    );

    return res.status(200).json({
      success: true,
      message: "Product master data synced successfully",
      data: {
        totalProcessed,
        totalInserted,
        totalUpdated,
        totalSkipped,
        skippedRows,
      },
    });
  } catch (error) {
    console.log("syncProductMaster: Caught error", error);
    res.status(400);
    throw error;
  } finally {
    await releaseLock("syncProductMaster");
    console.log("syncProductMaster: Lock released, finished");
  }
});

module.exports = { syncProductMaster };
