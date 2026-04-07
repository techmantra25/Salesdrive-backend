const asyncHandler = require("express-async-handler");
const Product = require("../models/product.model");

const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const Brand = require("../models/brand.model");
const SubBrand = require("../models/subBrand.model");

const bulkUploadProduct = asyncHandler(async (req, res) => {
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
    const [categories, collections, brands, segments] = await Promise.all([
      Category.find(),
      Collection.find(),
      Brand.find(),
      SubBrand.find(),
    ]);

    // ================= CREATE MAPS =================
    const categoryMap = {};
    const collectionMap = {};
    const brandMap = {};
    const segmentMap = {};

    categories.forEach((c) => (categoryMap[c.code] = c._id));
    collections.forEach((c) => (collectionMap[c.code] = c._id));
    brands.forEach((b) => (brandMap[b.code] = b._id));
    segments.forEach((s) => (segmentMap[s.code] = s._id));

    // ================= EXISTING PRODUCTS =================
    const allCodes = rows.map((r) => clean(r["S/4HANA Code"]));
    const existingProducts = await Product.find({
      s4hana_code: { $in: allCodes },
    }).select("s4hana_code");

    const existingSet = new Set(
      existingProducts.map((p) => p.s4hana_code)
    );

    // ✅ NEW: Track duplicates inside file
    const fileSet = new Set();

    const successData = [];
    const skippedRows = [];
    const bulkData = [];

    // ================= LOOP =================
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const s4hana_code = clean(row["S/4HANA Code"]);
        const description = clean(row["Description"]);

        // ================= REQUIRED =================
        if (!s4hana_code) throw new Error("S/4HANA Code is required");
        if (!description) throw new Error("Description is required");

        // ================= DUPLICATE IN FILE =================
        if (fileSet.has(s4hana_code)) {
          throw new Error("Duplicate in file");
        }
        fileSet.add(s4hana_code);

        // ================= DUPLICATE IN DB =================
        if (existingSet.has(s4hana_code)) {
          throw new Error("Product already exists");
        }

        // ================= LOOKUPS =================
        const catId = categoryMap[clean(row["Category Code"])];
        if (!catId) throw new Error("Invalid Category Code");

        const collectionId = collectionMap[clean(row["Collection Code"])];
        if (!collectionId) throw new Error("Invalid Collection Code");

        const brandId = brandMap[clean(row["Brand Code"])];
        if (!brandId) throw new Error("Invalid Brand Code");

        const segmentId =
          segmentMap[clean(row["Segment Code"])] || null;

        // ================= ENUM VALIDATION =================
        const uom = clean(row["UOM"]) || "pcs";
        if (!["pcs", "bndl", "box", "coil"].includes(uom)) {
          throw new Error(`Invalid UOM: ${uom}`);
        }

        // ================= FINAL PAYLOAD =================
        const payload = {
          s4hana_code,
          sku_group_id: clean(row["SKU Group Code"]),
          sku_group__name: clean(row["SKU Group Name"]),

          cat_id: catId,
          collection_id: collectionId,
          brand: brandId,
          segment: segmentId,

          size: clean(row["Size"]),
          color: clean(row["Color"]),
          pack: clean(row["Pack"]),
          std_pkg_in_pc: clean(row["Std Pkg in Pc"]),
          wp_pc: clean(row["W/P Pc"]),
          description,
          img_path: clean(row["Image Path"]),
          collection_product_type: clean(row["Product Type"]),
          product_valuation_type: clean(row["Product Valuation Type"]),
          product_hsn_code: clean(row["HSN Code"]),
          cgst: clean(row["CGST"]),
          sgst: clean(row["SGST"]),
          igst: clean(row["IGST"]),
          sbu: clean(row["SBU"]),
          uom,
          base_point: clean(row["Base Point"]),
          ean11: clean(row["EAN"]),
          status:
            clean(row["Status"]) === "false" ? false : true,
        };

        bulkData.push(payload);
        successData.push({
          index: i + 2,
          s4hana_code,
        });
      } catch (error) {
        skippedRows.push({
          index: i + 2,
          reason: error.message,
          ...row,
        });
      }
    }

    // ================= BULK INSERT =================
    if (bulkData.length > 0) {
      await Product.insertMany(bulkData, { ordered: false }); // ✅ safer insert
    }

    return res.status(200).json({
      message: "Bulk upload completed",
      insertedCount: bulkData.length,
      skippedCount: skippedRows.length,
      data: successData,
      skippedRows,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Bulk upload failed");
  }
});

module.exports = {
  bulkUploadProduct,
};