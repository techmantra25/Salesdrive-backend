const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const downloadProductList = asyncHandler(async (req, res) => {
  try {
    // Generate filename with Asia/Kolkata timezone
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Product_Master_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`
    );

    // Build filter object
    const filter = {};
    if (req.query.status !== undefined) {
      filter.status = req.query.status === "true";
    }
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }
    if (req.query.category) {
      filter.cat_id = req.query.category;
    }
    if (req.query.collection) {
      filter.collection_id = req.query.collection;
    }
    if (req.query.subBrand) {
      filter.subBrand = req.query.subBrand;
    }
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { product_code: searchRegex },
        { name: searchRegex },
        { sku_group_id: searchRegex },
        { sku_group__name: searchRegex },
        { product_hsn_code: searchRegex },
      ];
    }
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    // Populate fields
    const populateFields = [
      { path: "cat_id", select: "code name" },
      { path: "collection_id", select: "code name" },
      { path: "brand", select: "code name desc" },
      { path: "subBrand", select: "code name desc" },
      { path: "supplier", select: "supplierCode supplierName" },
    ];

    // CSV headers as per template
    const headers = [
      "Product Code",
      "Product Name",
      "Size",
      "Color",
      "Pack",
      "Product Type",
      "Product Valuation Type",
      "SKU Group Code",
      "SKU Group Name",
      "Supplier Code",
      "Supplier Name",
      "Brand Code",
      "Brand Name",
      "Brand Description",
      "Sub Brand Code",
      "Sub Brand Name",
      "Sub Brand Description",
      "Category Code",
      "Category Name",
      "Collection Code",
      "Collection Name",
      "HSN Code",
      "CGST",
      "SGST",
      "IGST",
      "UOM",
      "Pieces in Box",
      "Base Point",
      "Created Date Time",
      "Updated Date Time",
      "Status",
    ];

    // Create CSV stream
    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for streaming
    const cursor = Product.find(filter)
      .populate(populateFields)
      .sort({ product_code: 1 })
      .batchSize(1000)
      .cursor();

    cursor.on("data", (product) => {
      csvStream.write({
        "Product Code": product?.product_code || "",
        "Product Name": product?.name || "",
        Size: product?.size || "",
        Color: product?.color || "",
        Pack: product?.pack || "",
        "Product Type": product?.product_type || "",
        "Product Valuation Type": product?.product_valuation_type || "",
        "SKU Group Code": product?.sku_group_id || "",
        "SKU Group Name": product?.sku_group__name || "",
        "Supplier Code": product?.supplier?.supplierCode || "",
        "Supplier Name": product?.supplier?.supplierName || "",
        "Brand Code": product?.brand?.code || "",
        "Brand Name": product?.brand?.name || "",
        "Brand Description": product?.brand?.desc || "",
        "Sub Brand Code": product?.subBrand?.code || "",
        "Sub Brand Name": product?.subBrand?.name || "",
        "Sub Brand Description": product?.subBrand?.desc || "",
        "Category Code": product?.cat_id?.code || "",
        "Category Name": product?.cat_id?.name || "",
        "Collection Code": product?.collection_id?.code || "",
        "Collection Name": product?.collection_id?.name || "",

        "HSN Code": product?.product_hsn_code || "",
        CGST: product?.cgst || "",
        SGST: product?.sgst || "",
        IGST: product?.igst || "",

        UOM: product?.uom || "",
        "Pieces in Box": product?.no_of_pieces_in_a_box || "",
        "Base Point": product?.base_point || "",
        "Created Date Time":
          product?.createdAt && moment(product?.createdAt).isValid()
            ? moment(product?.createdAt)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD hh:mm A")
            : "",
        "Updated Date Time":
          product?.updatedAt && moment(product?.updatedAt).isValid()
            ? moment(product?.updatedAt)
                .tz("Asia/Kolkata")
                .format("YYYY-MM-DD hh:mm A")
            : "",
        Status: product?.status ? "Active" : "Inactive",
      });
    });
    cursor.on("end", () => {
      csvStream.end();
    });
    cursor.on("error", (err) => {
      csvStream.end();
      res.end();
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { downloadProductList };
