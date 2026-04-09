const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Product = require("../../models/product.model");
const Inventory = require("../../models/inventory.model");

const TIMEZONE = "Asia/Kolkata";

const buildDmsProductFilter = ({ distributorProductIds, query }) => {
  const filter = {
    _id: { $in: distributorProductIds },
  };

  if (query.status !== undefined) {
    filter.status = query.status === "true";
  }

  if (query.brand) {
    filter.brand = query.brand;
  }

  if (query.category) {
    filter.cat_id = query.category;
  }

  if (query.collection) {
    filter.collection_id = query.collection;
  }

 if (query.segment) {
  filter.segment = query.segment;
}
  if (query.startDate && query.endDate) {
    filter.updatedAt = {
      $gte: moment.tz(query.startDate, TIMEZONE).startOf("day").toDate(),
      $lte: moment.tz(query.endDate, TIMEZONE).endOf("day").toDate(),
    };
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search, "i");
    filter.$or = [
      { product_code: searchRegex },
      { name: searchRegex },
      { sku_group_id: searchRegex },
      { sku_group__name: searchRegex },
      { product_hsn_code: searchRegex },
      { ean11: searchRegex },
    ];
  }

  return filter;
};

const productPopulateFields = [
  {
    path: "cat_id",
    select: "",
  },
  {
    path: "collection_id",
    select: "",
  },
  {
    path: "brand",
    select: "",
  },
 {
  path: "segment",
  select: "",
},
  {
    path: "supplier",
    select: "",
  },
];

const paginatedProductListDms = asyncHandler(async (req, res) => {
  try {
    const distributorId = req?.user?._id;

    if (!distributorId) {
      return res.status(401).json({
        status: 401,
        error: true,
        message: "Distributor not authorized",
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = 30;
    const skip = (page - 1) * limit;

    const distributorProductIds = await Inventory.distinct("productId", {
      distributorId,
    });

    // If distributor has no mapped products, return empty paginated payload.
    if (!distributorProductIds.length) {
      return res.status(200).json({
        status: 200,
        message: "Product paginated list",
        data: [],
        pagination: {
          currentPage: page,
          limit,
          totalPages: 0,
          filteredCount: 0,
          totalItems: 0,
        },
      });
    }

    const filter = buildDmsProductFilter({
      distributorProductIds,
      query: req.query,
    });

    const baseDistributorFilter = { _id: { $in: distributorProductIds } };

    const [totalCount, filteredCount, products] = await Promise.all([
      Product.countDocuments(baseDistributorFilter),
      Product.countDocuments(filter),
      Product.find(filter)
        .populate(productPopulateFields)
        .sort({ product_code: 1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.status(200).json({
      status: 200,
      message: "Product paginated list",
      data: products,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalItems: totalCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const downloadPaginatedProductListDmsCsv = asyncHandler(async (req, res) => {
  try {
    const distributorId = req?.user?._id;

    if (!distributorId) {
      return res.status(401).json({
        status: 401,
        error: true,
        message: "Distributor not authorized",
      });
    }

    const distributorProductIds = await Inventory.distinct("productId", {
      distributorId,
    });

    if (!distributorProductIds.length) {
      return res.status(200).json({
        status: 200,
        message: "No products found for this distributor",
        data: [],
      });
    }

    const filter = buildDmsProductFilter({
      distributorProductIds,
      query: req.query,
    });

    const now = moment().tz(TIMEZONE);
    const fileName = `DMS_Product_List_${now.format("DD-MM-YYYY_hh-mm-ss-a")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

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
      "EAN",
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

    const csvStream = format({ headers });
    csvStream.pipe(res);

    const cursor = Product.find(filter)
      .populate(productPopulateFields)
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
        EAN: product?.ean11 || "",
        CGST: product?.cgst || "",
        SGST: product?.sgst || "",
        IGST: product?.igst || "",
        UOM: product?.uom || "",
        "Pieces in Box": product?.no_of_pieces_in_a_box || "",
        "Base Point": product?.base_point || "",
        "Created Date Time":
          product?.createdAt && moment(product?.createdAt).isValid()
            ? moment(product?.createdAt)
                .tz(TIMEZONE)
                .format("YYYY-MM-DD hh:mm A")
            : "",
        "Updated Date Time":
          product?.updatedAt && moment(product?.updatedAt).isValid()
            ? moment(product?.updatedAt)
                .tz(TIMEZONE)
                .format("YYYY-MM-DD hh:mm A")
            : "",
        Status: product?.status ? "Active" : "Inactive",
      });
    });

    cursor.on("end", () => {
      csvStream.end();
    });

    cursor.on("error", () => {
      csvStream.end();
      res.end();
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  paginatedProductListDms,
  downloadPaginatedProductListDmsCsv,
};
