const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");

const priceDownload = asyncHandler(async (req, res) => {
  try {
    // Generate filename with Asia/Kolkata timezone
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Price_Master_${now.format("DD-MM-YYYY_hh-mm-ss-a")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`
    );

    // Extract filters from query
    const {
      selectedCategory,
      selectedBrand,
      selectedCollection,
      selectedRegion,
      selectDistributor,
      selectedPriceType,
      selectedStatus,
      selectedProduct,
      dateRange,
      createdAtRange,
      expiresAtRange,
      productCode,
    } = req.query;

    // Build query object
    const query = {};

    // Category/Brand/Collection filters (for in-memory filtering after population)
    let filterByCategory = null;
    let filterByBrand = null;
    let filterByCollection = null;

    if (selectedCategory && selectedCategory !== "default")
      filterByCategory = selectedCategory;
    if (selectedBrand && selectedBrand !== "default")
      filterByBrand = selectedBrand;
    if (selectedCollection && selectedCollection !== "default")
      filterByCollection = selectedCollection;

    if (selectedRegion && selectedRegion !== "default")
      query.regionId = selectedRegion;
    if (selectDistributor && selectDistributor !== "default")
      query.distributorId = selectDistributor;
    if (selectedPriceType && selectedPriceType !== "default")
      query.price_type = selectedPriceType;
    if (selectedStatus && selectedStatus !== "default")
      query.status = selectedStatus;
    if (selectedProduct && selectedProduct !== "default")
      query.productId = selectedProduct;

    // productCode filter (lookup Product)
    if (productCode && productCode !== "default") {
      const product = await Product.findOne({ product_code: productCode });
      if (!product) {
        res.status(400);
        throw new Error("Product not found with the given product code");
      } else {
        query.productId = product._id;
      }
    }

    // Date Range filter
    if (dateRange) {
      const { startDate, endDate } =
        typeof dateRange === "string" ? JSON.parse(dateRange) : dateRange;
      if (startDate && endDate) {
        query.effective_date = {
          $gte: moment(startDate).startOf("day").toDate(),
          $lte: moment(endDate).endOf("day").toDate(),
        };
      }
    }

    // Created At Range filter
    if (createdAtRange) {
      const { startDate, endDate } =
        typeof createdAtRange === "string"
          ? JSON.parse(createdAtRange)
          : createdAtRange;
      if (startDate && endDate) {
        query.createdAt = {
          $gte: moment(startDate).startOf("day").toDate(),
          $lte: moment(endDate).endOf("day").toDate(),
        };
      }
    }

    // Expires At Range filter
    if (expiresAtRange) {
      const { startDate, endDate } =
        typeof expiresAtRange === "string"
          ? JSON.parse(expiresAtRange)
          : expiresAtRange;
      if (startDate && endDate) {
        query.expiresAt = {
          $gte: moment(startDate).startOf("day").toDate(),
          $lte: moment(endDate).endOf("day").toDate(),
        };
      }
    }

    // CSV headers as per your template
    const headers = [
      "Price Code",
      "Price Type",
      "Region Code",
      "Region Name",
      "Distributor Code",
      "Distributor Name",
      "Product Code",
      "Product Name",
      "Product Type",
      "Product HSN Code",
      "MRP",
      "DLP",
      "RLP",
      "Brand Code",
      "Brand Name",
      "Category Code",
      "Category Name",
      "Collection Code",
      "Collection Name",
      "SKU Group Code",
      "SKU Group Name",
      "Pieces in Box",
      "CGST",
      "SGST",
      "IGST",
      "SBU",
      "UOM",
      "Effective Date",
      "Created Date",
      "Expiry",
      "Status",
    ];

    // Create CSV stream
    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for streaming
    const cursor = Price.find(query)
      .populate([
        { path: "regionId", select: "code name" },
        { path: "distributorId", select: "dbCode name" },
        {
          path: "productId",
          select:
            "product_code name product_type product_hsn_code brand cat_id collection_id sku_group_id sku_group__name no_of_pieces_in_a_box cgst sgst igst sbu uom",
          populate: [
            { path: "brand", select: "code name" },
            { path: "cat_id", select: "code name" },
            { path: "collection_id", select: "code name" },
          ],
        },
      ])
      .sort({ _id: -1 })
      .batchSize(3000)
      .cursor();

    cursor.on("data", (price) => {
      // In-memory filter for category/brand/collection
      if (
        (filterByCategory &&
          price?.productId?.cat_id?._id?.toString() !== filterByCategory) ||
        (filterByBrand &&
          price?.productId?.brand?._id?.toString() !== filterByBrand) ||
        (filterByCollection &&
          price?.productId?.collection_id?._id?.toString() !==
            filterByCollection)
      ) {
        return; // skip this row
      }

      csvStream.write({
        "Price Code": price?.code || "",
        "Price Type": price?.price_type || "",
        "Region Code": price?.regionId?.code || "",
        "Region Name": price?.regionId?.name || "",
        "Distributor Code": price?.distributorId?.dbCode || "",
        "Distributor Name": price?.distributorId?.name || "",
        "Product Code": price?.productId?.product_code || "",
        "Product Name": price?.productId?.name || "",
        "Product Type": price?.productId?.product_type || "",
        "Product HSN Code": price?.productId?.product_hsn_code || "",
        MRP: price?.mrp_price || "",
        DLP: price?.dlp_price || "",
        RLP: price?.rlp_price || "",
        "Brand Code": price?.productId?.brand?.code || "",
        "Brand Name": price?.productId?.brand?.name || "",
        "Category Code": price?.productId?.cat_id?.code || "",
        "Category Name": price?.productId?.cat_id?.name || "",
        "Collection Code": price?.productId?.collection_id?.code || "",
        "Collection Name": price?.productId?.collection_id?.name || "",
        "SKU Group Code": price?.productId?.sku_group_id || "",
        "SKU Group Name": price?.productId?.sku_group__name || "",
        "Pieces in Box": price?.productId?.no_of_pieces_in_a_box || "",
        CGST: price?.productId?.cgst || "",
        SGST: price?.productId?.sgst || "",
        IGST: price?.productId?.igst || "",
        SBU: price?.productId?.sbu || "",
        UOM: price?.productId?.uom || "",
        "Effective Date": price?.effective_date
          ? moment(price?.effective_date)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY")
          : "",
        "Created Date": price?.createdAt
          ? moment(price?.createdAt).tz("Asia/Kolkata").format("DD-MM-YYYY")
          : "",
        Expiry: price?.expiresAt
          ? moment(price?.expiresAt)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY hh:mm A")
          : "",
        Status: price?.status ? "Active" : "Inactive",
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

module.exports = { priceDownload };
