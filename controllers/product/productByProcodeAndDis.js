const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");

const getProductByCodeAndDistributor = asyncHandler(async (req, res) => {
  try {
    const product_code = req?.params?.productCode;
    const distributorId = req?.params?.distributorId;

    // Validate product_code input
    if (!product_code) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: "Product code is required",
      });
    }

    // Find the product based on product_code
    const product = await Product.findOne({
      product_code: { $regex: product_code, $options: "i" },
      status: true,
    }).populate([
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
    ]);

    // If no product found
    if (!product) {
      return res.status(404).json({
        error: true,
        status: 404,
        message: "Product not found",
      });
    }

    let productDetails = { ...product?._doc };

    // Fetch pricing for the product
    try {
      const priceResponse = await axios.get(
        `${SERVER_URL}/api/v1/price/product-pricing/${product?._id?.toString()}?distributorId=${distributorId}`
      );

      if (priceResponse?.data?.data?.length > 0) {
        productDetails.price = priceResponse?.data?.data[0];
      } else {
        productDetails.price = null;
      }
    } catch (error) {
      productDetails.price = null; // Handle pricing error
    }

    // Fetch stock information for the product
    try {
      const stockResponse = await axios.get(
        `${SERVER_URL}/api/v1/inventory/get-stock-product/${product?._id?.toString()}?distributorId=${distributorId}`
      );

      if (stockResponse?.data?.data) {
        productDetails.inventory = stockResponse?.data?.data;
      } else {
        productDetails.inventory = null;
      }
    } catch (error) {
      productDetails.inventory = null; // Handle stock error
    }

    // fetch product norm for the distributor
    try {
      const normResponse = await axios.get(
        `${SERVER_URL}/api/v1/product_norm/get_product_norm_by_db_id_and_product_id/distributor/${distributorId?.toString()}/product/${product?._id?.toString()}`
      );

      if (normResponse?.data?.data) {
        productDetails.productNorm = normResponse?.data?.data;
      } else {
        productDetails.productNorm = null;
      }
    } catch (error) {
      productDetails.productNorm = null;
    }

    // Return product details with price and stock info
    return res.status(200).json({
      status: 200,
      message: "Product fetched successfully",
      data: productDetails,
    });
  } catch (error) {
    console.error("Error in getProductByCode:", error);
    return res.status(400).json({
      error: true,
      status: 400,
      message: "An error occurred while processing your request",
    });
  }
});

module.exports = { getProductByCodeAndDistributor };
