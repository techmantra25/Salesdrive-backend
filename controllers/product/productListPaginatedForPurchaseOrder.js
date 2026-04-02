const asyncHandler = require("express-async-handler");
const { SERVER_URL } = require("../../config/server.config");
const Product = require("../../models/product.model");
const axios = require("axios");
const Distributor = require("../../models/distributor.model");
const Price = require("../../models/price.model");
const { getBatchProductPricing } = require("../product/utils/pricing.utils")
const { getBatchInventoryStock } = require("../product/utils/inventory.utils")

console.time("API_TOTAL");
const productListPaginatedForPurchaseOrder = asyncHandler(async (req, res) => {
  try {
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const distributorId = req?.user?._id;

    const search = req?.query?.search;
    const size = req?.query?.size;
    const color = req?.query?.color;

    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const dbBrandIds = distributor?.brandId || [];

    if (!dbBrandIds || dbBrandIds.length === 0) {
      res.status(404);
      throw new Error("No brands found for this distributor");
    }

    const DisRegion = distributor?.regionId?.toString();

    // Get all product IDs that have pricing for this distributor or region
    console.time("Price_find")
    const productHavePricingIds = await Price.find({
      status: true,
      $or: [
        { distributorId: distributorId },
        { regionId: DisRegion },
        { price_type: "national" },
      ],
    }).distinct("productId");
    console.timeEnd("Price_find")
    
    // If no products found, handle error
    if (!productHavePricingIds || productHavePricingIds.length === 0) {
      res.status(404);
      throw new Error("No products found with pricing for this distributor");
    }

    const { categoryId, collectionId, brandId, brandIds, subBrandId } =
      req.query;

    const query = {
      status: true,
      _id: { $in: productHavePricingIds },
    };

    if (categoryId && categoryId !== "undefined" && categoryId !== "null") {
      query.cat_id = categoryId;
    }

    if (
      collectionId &&
      collectionId !== "undefined" &&
      collectionId !== "null"
    ) {
      query.collection_id = collectionId;
    }

    if (brandId && brandId !== "undefined" && brandId !== "null") {
      query.brand = brandId;
    }

    if (
      brandIds &&
      brandIds !== "undefined" &&
      brandIds !== "null" &&
      brandIds.length > 0
    ) {
      query.brand = { $in: brandIds };
    }

    if (!brandId && !brandIds) {
      query.brand = { $in: dbBrandIds };
    }

    if (subBrandId && subBrandId !== "undefined" && subBrandId !== "null") {
      query.subBrand = subBrandId;
    }

    if (search) {
      query.$or = [
        { product_code: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { sku_group_id: { $regex: search, $options: "i" } },
        { sku_group__name: { $regex: search, $options: "i" } },
      ];
    }

    if (size && size !== "undefined" && size !== "null") {
      query.size = { $regex: size, $options: "i" };
    }

    if (color && color !== "undefined" && color !== "null") {
      query.color = { $regex: color, $options: "i" };
    }

    // supplier not null
    query.supplier = { $ne: null };

    // category should not include
    // const excludedCategories = [
    //   "683da5ac52a1a64cf2b5f6aa", // FREE
    // ];
    // query.cat_id = {
    //   $nin: excludedCategories,
    // };

    // Fetch total product count and filtered count


    console.time("QUERY_EXECUTION")
    const [totalCount, totalFilteredCount] = await Promise.all([
      Product.countDocuments({ status: true }),
      Product.countDocuments(query),
    ]);
    console.timeEnd("QUERY_EXECUTION")


    // Fetch paginated products

    console.time("PRODUCT_LIST")
    const productList = await Product.find(query)
      .populate([
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
          path: "supplier",
          select: "",
        },
      ])
      .sort({ product_code: 1 })
      .skip(skip)
      .limit(limit);
      console.timeEnd("PRODUCT_LIST")

    const totalPages = Math.ceil(totalFilteredCount / limit);

    let resultProductList = [...productList];

    // get pricing

    console.time("RESULTPRODUCT_LIST_PRICING")
    //old code
    // resultProductList = await Promise.all(
    //   resultProductList.map(async (product) => {
    //     try {
    //       const priceResponse = await axios.get(
    //         `${SERVER_URL}/api/v1/price/product-pricing/${product?._doc?._id?.toString()}?distributorId=${distributorId}`
    //       );

    //       if (priceResponse?.data?.data?.length > 0) {
    //         return {
    //           ...product?._doc,
    //           price: priceResponse?.data?.data[0],
    //         };
    //       } else {
    //         return {
    //           ...product?._doc,
    //           price: null,
    //         };
    //       }
    //     } catch (error) {
    //       return {
    //         ...product?._doc,
    //         price: null,
    //       };
    //     }
    //   })
    // );

    const productIds = resultProductList.map(p=>p._doc?._id.toString() ||p._id?.toString() );
    const batchPrices = await getBatchProductPricing(productIds,distributorId);
    resultProductList = resultProductList.map((product) =>{
      const productId = product._doc?.id?.toString() || product._id?.toString();
      const prices = batchPrices[productId] || [];

      return{
        ...product._doc,
        price:prices.length > 0 ? prices[0] : null,
      }
    })
    console.timeEnd("RESULTPRODUCT_LIST_PRICING")

    // get inventory
    console.time("RESULTPRODUCT_LIST_INVENTORY")
    //old code
    // resultProductList = await Promise.all(
    //   resultProductList.map(async (product) => {
    //     try {
    //       const response = await axios.get(
    //         `${SERVER_URL}/api/v1/inventory/get-stock-product/${product?._id?.toString()}?distributorId=${distributorId}`
    //       );

    //       if (response?.data?.data) {
    //         return {
    //           ...product,
    //           inventory: response?.data?.data,
    //         };
    //       } else {
    //         return {
    //           ...product,
    //           inventory: null,
    //         };
    //       }
    //     } catch (error) {
    //       return {
    //         ...product,
    //         inventory: null,
    //       };
    //     }
    //   })
    // );
    const productIdsForInventory = resultProductList.map(p=>p._id?.toString());
    const batchInventory = await getBatchInventoryStock(productIdsForInventory,distributorId);

    resultProductList = resultProductList.map((product) =>{
      const productId = product._id?.toString();
      const inventory = batchInventory[productId] || null;
      return {
        ...product,
        inventory:inventory,
      } 
    })
    console.timeEnd("RESULTPRODUCT_LIST_INVENTORY")

    // get product norm for the distributor
    console.time("RESULTPRODUCT_LIST_DISTRIBUTOR")
    resultProductList = await Promise.all(
      resultProductList.map(async (product) => {
        try {
          const response = await axios.get(
            `${SERVER_URL}/api/v1/product_norm/get_product_norm_by_db_id_and_product_id/distributor/${distributorId?.toString()}/product/${product?._id?.toString()}`
          );

          if (response?.data?.data) {
            return {
              ...product,
              productNorm: response?.data?.data,
            };
          } else {
            return {
              ...product,
              productNorm: null,
            };
          }
        } catch (error) {
          return {
            ...product,
            productNorm: null,
          };
        }
      })
    );
    console.timeEnd("RESULTPRODUCT_LIST_DISTRIBUTOR")

    const responseData = {
      status: 200,
      message: "Product list paginated",
      data: resultProductList,
      pagination: {
        currentPage: page,
        limit: limit,
        totalPages: totalPages,
        totalCount: totalCount,
        filteredCount: totalFilteredCount,
      },
    };
    console.timeEnd("API_TOTAL");

    return res.status(200).json(responseData);
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { productListPaginatedForPurchaseOrder };
