const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const Inventory = require("../../models/inventory.model");
const { getBatchProductPricing } = require("../product/utils/pricing.utils");
const { getBatchInventoryStock } = require("../product/utils/inventory.utils");

const productListPaginated = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;
    const distributorId = req?.user?._id;
    const {
      categoryId,
      collectionId,
      brandId,
      subBrandId,
      godownId,
      quotationDate,
    } = req.query;

    const hasGodownFilter =
      godownId && godownId !== "undefined" && godownId !== "null";

    // --- Only products that HAVE an inventory record for the given godown ---
    // If no godownId is supplied, we show NOTHING (no silent fallback to
    // "all godowns"), since godown-scoped inventory is now mandatory.
    let productIdsWithInventory = [];
    if (hasGodownFilter) {
      productIdsWithInventory = await Inventory.distinct("productId", {
        distributorId,
        godownId,
      });
    }

    const query = {
      status: true,
      _id: { $in: productIdsWithInventory },
    };

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
      const tokens = search.split(/[\s-]+/).filter(Boolean);
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

    console.time("PRODUCT_DB");
    const [totalCount, totalFilteredCount, productList] = hasGodownFilter
      ? await Promise.all([
          Product.countDocuments({ status: true, _id: { $in: productIdsWithInventory } }),
          Product.countDocuments(query),
          Product.find(query)
            .populate([
              { path: "cat_id", select: "" },
              { path: "collection_id", select: "" },
              { path: "brand", select: "" },
              { path: "supplier", select: "" },
            ])
            .sort({ product_code: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ])
      : [0, 0, []]; // no godownId → return empty result immediately
    console.timeEnd("PRODUCT_DB");

    const productIds_batch = productList.map((p) => p._id.toString());

    console.time("EXTERNAL_APIS");
    const [pricingByProduct, inventoryByProduct] = productIds_batch.length
      ? await Promise.all([
          getBatchProductPricing(productIds_batch, distributorId, null, quotationDate),
          getBatchInventoryStock(productIds_batch, distributorId, godownId),
        ])
      : [{}, {}];
    console.timeEnd("EXTERNAL_APIS");

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
    return res.status(200).json(responseData);
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { productListPaginated };