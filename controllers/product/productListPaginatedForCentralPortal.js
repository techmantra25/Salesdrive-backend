const asyncHandler = require("express-async-handler");
const { SERVER_URL } = require("../../config/server.config");
const Product = require("../../models/product.model");
const axios = require("axios");

const productListPaginatedForCentralPortal = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;
    const search = req?.query?.search;
    const distributorId = req?.query?.distributorId;

    const { categoryId, collectionId, brandId, subBrandId } = req.query;

    const query = {
      status: true,
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

    if (subBrandId && subBrandId !== "undefined" && subBrandId !== "null") {
      query.subBrand = subBrandId;
    }

    if (search) {
      query.$or = [
        { product_code: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    // supplier not null
    query.supplier = { $ne: null };

    // Fetch total product count and filtered count
    const [totalCount, totalFilteredCount] = await Promise.all([
      Product.countDocuments({ status: true }),
      Product.countDocuments(query),
    ]);

    // Fetch paginated products
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
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalFilteredCount / limit);

    let resultProductList = [...productList];

    // get pricing
    resultProductList = await Promise.all(
      resultProductList.map(async (product) => {
        try {
          const priceResponse = await axios.get(
            `${SERVER_URL}/api/v1/price/product-pricing/${product?._doc?._id?.toString()}?distributorId=${distributorId}`
          );

          if (priceResponse?.data?.data?.length > 0) {
            return {
              ...product?._doc,
              price: priceResponse?.data?.data[0],
            };
          } else {
            return {
              ...product?._doc,
              price: null,
            };
          }
        } catch (error) {
          return {
            ...product?._doc,
            price: null,
          };
        }
      })
    );

    // get inventory
    resultProductList = await Promise.all(
      resultProductList.map(async (product) => {
        try {
          const response = await axios.get(
            `${SERVER_URL}/api/v1/inventory/get-stock-product/${product?._id?.toString()}?distributorId=${distributorId?.toString()}`
          );

          if (response?.data?.data) {
            return {
              ...product,
              inventory: response?.data?.data,
            };
          } else {
            return {
              ...product,
              inventory: null,
            };
          }
        } catch (error) {
          return {
            ...product,
            inventory: null,
          };
        }
      })
    );

    // get product norm for the distributor
    resultProductList = await Promise.all(
      resultProductList.map(async (product) => {
        try {
          console.log({
            productId: product?._id?.toString(),
            distributorId: distributorId?.toString(),
          });

          const response = await axios.get(
            `${SERVER_URL}/api/v1/product_norm/get_product_norm_by_db_id_and_product_id/distributor/${distributorId?.toString()}/product/${product?._id?.toString()}`
          );

          console.log({ response });

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
          console.log("Error fetching product norm:", error);

          return {
            ...product,
            productNorm: null,
          };
        }
      })
    );

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

    return res.status(200).json(responseData);
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { productListPaginatedForCentralPortal };
