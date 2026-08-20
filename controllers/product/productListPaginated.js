const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const Inventory = require("../../models/inventory.model");
const { getBatchProductPricing } = require("../product/utils/pricing.utils");
const { getBatchInventoryStock } = require("../product/utils/inventory.utils");

// console.time("API_TOTAL");
const productListPaginated = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;
    const distributorId = req?.user?._id;
    const { categoryId, collectionId, brandId, subBrandId, godownId } = req.query;

    // Normalize godownId once — treat "undefined"/"null" strings (which
    // can arrive from the frontend when no godown is selected) as absent.
    const hasGodownFilter =
      godownId && godownId !== "undefined" && godownId !== "null";

    // Product list is driven entirely by the Product collection — every
    // active product shows here regardless of whether it has any
    // inventory row. Inventory (via getBatchInventoryStock below) is only
    // used to attach stock numbers, never to decide which products appear.
    const query = { status: true };

    const filterFields = [
      { field: "cat_id", value: categoryId },
      { field: "collection_id", value: collectionId },
      { field: "brand", value: brandId },
      { field: "subBrand", value: subBrandId },
    ];

    filterFields.forEach(({ field, value }) => {
      if (value && value !== "undefined" && value !== "null") {
        query[field] = value;
      }
    });

    if (req.query.search) {
      const search = req.query.search.trim();

      // Split by space or dash
      const tokens = search.split(/[\s-]+/).filter(Boolean);

      // Every token must match
      query.$and = tokens.map((token) => ({
        $or: [
          { product_code: { $regex: token, $options: "i" } },
          { name: { $regex: token, $options: "i" } },
          { sku_group_id: { $regex: token, $options: "i" } },
          { sku_group__name: { $regex: token, $options: "i" } },
          { product_hsn_code: { $regex: token, $options: "i" } },
        ],
      }));
    }

    // Parallel execution for counts and products

    console.time("PRODUCT_DB");
    const [totalCount, totalFilteredCount, productList] = await Promise.all([
      Product.countDocuments({ status: true }),
      Product.countDocuments(query),
      Product.find(query)
        .populate([
          { path: "cat_id", select: "" },
          { path: "collection_id", select: "" },
          { path: "brand", select: "" },
          {
            path: "supplier",
            select: "",
          },
        ])
        .sort({
          product_code: 1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    console.timeEnd("PRODUCT_DB");

    // Batch API calls for pricing and inventory
    const productIds_batch = productList.map((p) => p._id.toString());

    console.time("EXTERNAL_APIS");
    const [pricingByProduct, inventoryByProduct] = await Promise.all([
      getBatchProductPricing(productIds_batch, distributorId),
      getBatchInventoryStock(
        productIds_batch,
        distributorId,
        hasGodownFilter ? godownId : undefined
      ),
    ]);
    console.timeEnd("EXTERNAL_APIS");

    // Map results with pricing and inventory data
    console.time("DATA_MAPPING");
    const resultProductList = productList.map((product) => {
      const productId = product._id.toString();

      const priceArray = pricingByProduct[productId] || [];
      const price = priceArray.length > 0 ? priceArray[0] : null;

      const inventory = inventoryByProduct[productId] || null;

      return {
        ...product,
        price,
        inventory,
        inventoryId: inventory,
      };
    });
    console.timeEnd("DATA_MAPPING");

    const responseData = {
      status: 200,
      message: "Product list paginated",
      data: resultProductList,
      pagination: {
        currentPage: page,
        limit: limit,
        totalPages: Math.ceil(totalFilteredCount / limit),
        totalCount: totalCount,
        filteredCount: totalFilteredCount,
      },
    };
    // console.timeEnd("API_TOTAL");
    return res.status(200).json(responseData);
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { productListPaginated };