const ProductNorms = require("../models/productNorms.model");
const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Product = require("../models/product.model");

/**
 * To create a new product norm
 */
const createProductNorm = asyncHandler(async (req, res) => {
  try {
    const { productId, distributorId, salableQtyNorm } = req.body;

    // Validate required fields
    if (!productId) {
      res.status(400);
      throw new Error("Product ID is required");
    }

    // Validate ObjectId
    if (!distributorId) {
      res.status(400);
      throw new Error("Distributor ID is required");
    }

    // Check if the product ID is valid
    if (salableQtyNorm === undefined) {
      res.status(400);
      throw new Error("Salable quantity norm is required");
    }

    // Check if the product norm already exists
    const existingNorm = await ProductNorms.findOne({
      productId,
      distributorId,
    });

    if (existingNorm) {
      res.status(400);
      throw new Error("Product norm already exists for this distributor");
    }

    // Create new product norm
    const productNorm = await ProductNorms.create({
      productId,
      distributorId,
      salableQtyNorm,
    });

    res.status(201).json({
      status: 201,
      error: false,
      message: "Product norm created successfully",
      data: productNorm,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

/**
 * To update product norm
 */
const updateProductNorm = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { salableQtyNorm } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid product norm ID");
    }

    // Check if norm exists
    const productNorm = await ProductNorms.findById(id);
    if (!productNorm) {
      res.status(404);
      throw new Error("Product norm not found");
    }

    // Update the norm
    productNorm.salableQtyNorm = salableQtyNorm;
    await productNorm.save();

    res.status(200).json({
      status: 200,
      error: false,
      message: "Product norm updated successfully",
      data: productNorm,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

/**
 * To get all product norms
 */
const getProductNormsPaginated = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, distributorId, search } = req.query;

    const currentPage = parseInt(page, 10);
    const itemsLimit = parseInt(limit, 10);
    const skip = (currentPage - 1) * itemsLimit;

    let productIdsToFilterBy = null;

    if (search && search.trim() !== "") {
      const searchTerm = search.trim();
      const productSearchConditions = [
        { product_code: { $regex: searchTerm, $options: "i" } },
        { name: { $regex: searchTerm, $options: "i" } },
      ];

      const productQueryFilter = { $or: productSearchConditions };

      const matchingProducts = await Product.find(productQueryFilter).select(
        "_id"
      );
      const idsFromProductSearch = matchingProducts.map((p) => p._id);

      if (idsFromProductSearch.length === 0) {
        res.status(200).json({
          status: 200,
          error: false,
          message:
            "Product norms retrieved successfully (no products matched search criteria)",
          data: [],
          pagination: {
            total: 0,
            page: currentPage,
            limit: itemsLimit,
            pages: 0,
          },
        });
        return;
      }
      productIdsToFilterBy = idsFromProductSearch;
    }

    const productNormsQueryFilter = {};
    if (distributorId) {
      if (!mongoose.isValidObjectId(distributorId)) {
        res.status(400).json({
          status: 400,
          error: true,
          message: "Invalid distributorId format.",
        });
        return;
      }
      productNormsQueryFilter.distributorId = distributorId;
    }

    if (productIdsToFilterBy) {
      productNormsQueryFilter.productId = { $in: productIdsToFilterBy };
    } else if (search && search.trim() !== "") {
      res.status(200).json({
        status: 200,
        error: false,
        message:
          "Product norms retrieved successfully (no products matched search criteria)",
        data: [],
        pagination: {
          total: 0,
          page: currentPage,
          limit: itemsLimit,
          pages: 0,
        },
      });
      return;
    }

    const productNorms = await ProductNorms.find(productNormsQueryFilter)
      .populate("productId")
      .populate("distributorId")
      .skip(skip)
      .limit(itemsLimit)
      .sort({ createdAt: -1 });

    const total = await ProductNorms.countDocuments(productNormsQueryFilter);

    res.status(200).json({
      status: 200,
      error: false,
      message: "Product norms retrieved successfully",
      data: productNorms,
      pagination: {
        total,
        page: currentPage,
        limit: itemsLimit,
        pages: Math.ceil(total / itemsLimit),
      },
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

/**
 * To get product norm by ID
 */
const getProductNormById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid product norm ID");
    }

    const productNorm = await ProductNorms.findById(id)
      .populate("productId", "")
      .populate("distributorId", "");

    if (!productNorm) {
      res.status(404);
      throw new Error("Product norm not found");
    }

    res.status(200).json({
      status: 200,
      error: false,
      message: "Product norm found",
      data: productNorm,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

/**
 * To get product norms by distributor ID and product ID
 */
const getProductNormByDistributorId = asyncHandler(async (req, res) => {
  try {
    const { distributorId, productId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(distributorId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid distributor ID",
      });
    }

    const productNorms = await ProductNorms.findOne({
      distributorId,
      productId,
    })
      .populate("productId", "")
      .populate("distributorId", "");

    if (!productNorms) {
      res.status(404);
      throw new Error(
        "No product norms found for this distributor with this product"
      );
    }

    res.status(200).json({
      status: 200,
      error: false,
      message: "Product norms found",
      data: productNorms,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = {
  createProductNorm,
  updateProductNorm,
  getProductNormsPaginated,
  getProductNormById,
  getProductNormByDistributorId,
};
