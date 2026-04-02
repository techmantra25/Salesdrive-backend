const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const Inventory = require("../../models/inventory.model");
const { getBatchProductPricing } = require("../product/utils/pricing.utils")
const { getBatchInventoryStock } =require("../product/utils/inventory.utils")

// console.time("API_TOTAL");
const productListPaginated = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;
    const search = req?.query?.search;
    const distributorId = req?.user?._id;
    const { categoryId, collectionId, brandId, subBrandId } = req.query;

    // Get product IDs from inventory in which available quantity is greater than 0

    console.time("INVENTORY_QUERY");
    const inventoryIds = await Inventory.find(
      {
        distributorId,
        availableQty: { $gt: 0 },
      },
      {
        productId: 1,
        _id: 0,
      }
    ).lean();
    console.timeEnd("INVENTORY_QUERY");

    if (!inventoryIds.length) {
      res.status(404);
      throw new Error("No inventory found for this distributor");
    }

    const productIds = inventoryIds.map((inv) => inv.productId);

    // Build query object
    const query = { status: true, _id: { $in: productIds } };

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

    if (search) {
      query.$or = [
        { product_code: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { ean11: { $regex: search, $options: "i" } },// added ean code search functionality
      ];
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
        .limit(limit).lean()
    ]);
    console.timeEnd("PRODUCT_DB");


    // Batch API calls for pricing and inventory
    const productIds_batch = productList.map((p) => p._id.toString());

    console.time("EXTERNAL_APIS");
    const [pricingByProduct, inventoryByProduct] = await Promise.all([
      // Promise.allSettled(
      //   productIds_batch.map((id) =>
      //     axios.get(
      //       `${SERVER_URL}/api/v1/price/product-pricing/${id}?distributorId=${distributorId}`
      //     )
      //   )
      // ),
      getBatchProductPricing(productIds_batch,distributorId),

      // Promise.allSettled(
      //   productIds_batch.map((id) =>
      //     axios.get(
      //       `${SERVER_URL}/api/v1/inventory/get-stock-product/${id}?distributorId=${distributorId}`
      //     )
      //   )
      // ),
      getBatchInventoryStock(productIds_batch, distributorId),

    ]);
    console.timeEnd("EXTERNAL_APIS");

    // Map results with pricing and inventory data
    console.time("DATA_MAPPING");
    const resultProductList = productList.map((product) => {

      const productId = product._id.toString();
      // const pricingResult = pricingResponses[index];
      // const inventoryResult = inventoryResponses[index];

      // const price =
      //   pricingResult.status === "fulfilled" &&
      //   pricingResult.value?.data?.data?.length > 0
      //     ? pricingResult.value.data.data[0]
      //     : null;
      const priceArray = pricingByProduct[productId] || [];
      const price = priceArray.length >0 ? priceArray[0] :null;

      // const inventory =
      //   inventoryResult.status === "fulfilled" &&
      //   inventoryResult.value?.data?.data
      //     ? inventoryResult.value.data.data
      //     : null;

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
