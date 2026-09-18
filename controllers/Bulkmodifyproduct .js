const asyncHandler = require("express-async-handler");
const Product = require("../models/product.model");

const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const Brand = require("../models/brand.model");
const SubBrand = require("../models/subBrand.model");

const bulkModifyProduct = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;
    console.log(rows);

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        message: "No valid data found",
        data: [],
        skippedRows: [],
      });
    }

    // ================= CLEAN FUNCTION =================
    const clean = (val) =>
      val !== undefined && val !== null ? val.toString().trim() : "";

    // ================= MASTER DATA (OPTIMIZED) =================
    const [categories, collections, brands, subBrands] = await Promise.all([
      Category.find(),
      Collection.find(),
      Brand.find(),
      SubBrand.find(),
    ]);

    // ================= CREATE MAPS =================
    const categoryMap = {};
    const collectionMap = {};
    const brandMap = {};
    const subBrandMap = {};

    categories.forEach((c) => (categoryMap[c.code] = c._id));
    collections.forEach((c) => (collectionMap[c.code] = c._id));
    brands.forEach((b) => (brandMap[b.code] = b._id));
    subBrands.forEach((s) => (subBrandMap[s.code] = s._id));

    // ================= EXISTING PRODUCTS =================
    // Unlike create, here the product MUST already exist — this endpoint
    // is for modifying existing rows, not inserting new ones.
    const allCodes = rows.map((r) => clean(r["Product Code"]));
    const existingProducts = await Product.find({
      product_code: { $in: allCodes },
    }).select("_id product_code");

    const existingMap = {};
    existingProducts.forEach((p) => {
      existingMap[p.product_code] = p._id;
    });

    // ✅ Track duplicates inside file
    const fileSet = new Set();

    const successData = [];
    const skippedRows = [];
    const bulkOps = [];

    // ================= LOOP =================
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const product_code = clean(row["Product Code"]);

        // ================= REQUIRED =================
        // Product Code is the ONLY required field now — everything else
        // is optional and only updated if the CSV actually provided it.
        if (!product_code) throw new Error("Product Code is required");

        // ================= DUPLICATE IN FILE =================
        if (fileSet.has(product_code)) {
          throw new Error("Duplicate in file");
        }
        fileSet.add(product_code);

        // ================= MUST EXIST IN DB =================
        const existingId = existingMap[product_code];
        if (!existingId) {
          throw new Error("Product does not exist");
        }

        // ================= OPTIONAL LOOKUPS =================
        // If the CSV gave a code, it must resolve to a real record (bad data
        // still fails the row). If the CSV left it blank, we skip it and the
        // existing DB value is left untouched.
        const name = clean(row["Product Name"]); // optional now too

        const categoryCode = clean(row["Category Code"]);
        let catId;
        if (categoryCode) {
          catId = categoryMap[categoryCode];
          if (!catId) throw new Error("Invalid Category Code");
        }

        const collectionCode = clean(row["Collection Code"]);
        let collectionId;
        if (collectionCode) {
          collectionId = collectionMap[collectionCode];
          if (!collectionId) throw new Error("Invalid Collection Code");
        }

        const brandCode = clean(row["Brand Code"]);
        let brandId;
        if (brandCode) {
          brandId = brandMap[brandCode];
          if (!brandId) throw new Error("Invalid Brand Code");
        }

        // subBrand stays optional, but we only touch it if the file gave a code
        const subBrandCode = clean(row["subBrand Code"]);
        const subBrandId = subBrandCode
          ? subBrandMap[subBrandCode] || null
          : undefined; // undefined => won't be added to $set below

        // ================= ENUM VALIDATION =================
        // Only enforce/override UOM if the file actually provided one;
        // otherwise leave the existing DB value alone.
        const uomRaw = clean(row["UOM"]);
        let uom;
        if (uomRaw) {
          if (!["pcs", "bndl", "box", "coil"].includes(uomRaw)) {
            throw new Error(`Invalid UOM: ${uomRaw}`);
          }
          uom = uomRaw;
        }

        // ================= BUILD PAYLOAD (skip blanks) =================
        // Helper: only add the key if the CSV actually had a value for it,
        // so bulkWrite's $set never wipes an existing field with "".
        const payload = {};
        const setIfPresent = (key, value) => {
          if (value !== undefined && value !== null && value !== "") {
            payload[key] = value;
          }
        };

        // Product Code identifies the row (used as the filter, not $set).
        // Everything else is optional — only set when the CSV cell is non-empty.
        setIfPresent("name", name);
        setIfPresent("cat_id", catId);
        setIfPresent("collection_id", collectionId);
        setIfPresent("brand", brandId);
        setIfPresent("subBrand", subBrandId);
        setIfPresent("sku_group_id", clean(row["SKU Group Code"]));
        setIfPresent("sku_group__name", clean(row["SKU Group Name"]));
        setIfPresent("size", clean(row["Size"]));
        setIfPresent("color", clean(row["Color"]));
        setIfPresent("pack", clean(row["Pack"]));
        setIfPresent("no_of_pieces_in_a_box", clean(row["Std Pkg in Pc"]));
        setIfPresent("wp_pc", clean(row["W/P Pc"]));
        setIfPresent("img_path", clean(row["Image Path"]));
        setIfPresent("product_type", clean(row["Product Type"]));
        setIfPresent(
          "product_valuation_type",
          clean(row["Product Valuation Type"])
        );
        setIfPresent("product_hsn_code", clean(row["HSN Code"]));
        setIfPresent("cgst", clean(row["CGST"]));
        setIfPresent("sgst", clean(row["SGST"]));
        setIfPresent("igst", clean(row["IGST"]));
        setIfPresent("sbu", clean(row["SBU"]));
        setIfPresent("uom", uom);
        setIfPresent("base_point", clean(row["Base Point"]));
        setIfPresent("ean11", clean(row["EAN"]));

        // Status: only override if the column was actually present in the row
        if (Object.prototype.hasOwnProperty.call(row, "Status")) {
          const statusRaw = clean(row["Status"]);
          if (statusRaw !== "") {
            payload.status = statusRaw === "false" ? false : true;
          }
        }

        // If the row only had a Product Code (nothing else to update),
        // $set would be empty — Mongo rejects an empty $set, so just skip
        // queuing an update for it, but still report it as a success.
        if (Object.keys(payload).length > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: existingId },
              update: { $set: payload },
            },
          });
        }

        successData.push({
          index: i + 2,
          product_code,
        });
      } catch (error) {
        skippedRows.push({
          index: i + 2,
          reason: error.message,
          ...row,
        });
      }
    }

    // ================= BULK UPDATE =================
    let bulkResult = { matchedCount: 0, modifiedCount: 0 };
    if (bulkOps.length > 0) {
      bulkResult = await Product.bulkWrite(bulkOps, { ordered: false });
    }

    return res.status(200).json({
      message: "Bulk modification completed",
      updatedCount: bulkResult.modifiedCount ?? bulkOps.length,
      matchedCount: bulkResult.matchedCount ?? bulkOps.length,
      skippedCount: skippedRows.length,
      data: successData,
      skippedRows,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Bulk modification failed");
  }
});

module.exports = {
  bulkModifyProduct,
};