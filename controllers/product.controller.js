const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const Product = require("../models/product.model");
const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const Brand = require("../models/brand.model");
const Price = require("../models/price.model");

const createProduct = asyncHandler(async (req, res) => {
  try {
    const {
      product_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      subBrand,
      supplier,
      size,
      color,
      pack,
      no_of_pieces_in_a_box,
      name,
      img_path,
      product_type,
      product_valuation_type,
      product_hsn_code,
      cgst,
      sgst,
      igst,
      sbu,
      uom,
      base_point,
    } = req.body;

    let productExist = await Product.findOne({
      product_code: req.body.product_code,
    });

    if (productExist) {
      res.status(400);
      throw new Error("Product already exists");
    }

    const productData = await Product.create({
      product_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      subBrand,
      supplier,
      size,
      color,
      pack,
      no_of_pieces_in_a_box,
      name,
      img_path,
      product_type,
      product_valuation_type,
      product_hsn_code,
      cgst,
      sgst,
      igst,
      sbu,
      uom,
      base_point,
    });

    return res.status(201).json({
      status: 201,
      message: "Product created successfully",
      data: productData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const productDetail = asyncHandler(async (req, res) => {
  try {
    let productData = await Product.findOne({
      _id: req.params.proId,
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
      {
        path: "subBrand",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "Product Data",
      data: productData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const updateProduct = asyncHandler(async (req, res) => {
  try {
    let message;

    // Check if request is trying to activate the product (status: true)
    if (req.body.hasOwnProperty("status") && req.body.status === true) {
      // Check if there's at least one active price for this product
      const activePriceExists = await Price.findOne({
        productId: req.params.proId,
        status: true,
      });

      if (!activePriceExists) {
        // No active price found - block the activation
        return res.status(400).send({
          error: true,
          message:
            "Cannot activate product. No active price found for this product.",
        });
      }
    }

    // Proceed with the Product update
    let productList = await Product.findOneAndUpdate(
      { _id: req.params.proId },
      req.body,
      { new: true },
    );

    if (productList) {
      message = {
        error: false,
        message: "Product updated successfully",
        data: productList,
      };
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Product not found or not updated",
      };
      return res.status(404).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const productAllList = asyncHandler(async (req, res) => {
  try {
    let productList = await Product.find({})
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
          path: "subBrand",
          select: "",
        },
        {
          path: "supplier",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All product list",
      data: productList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const productPaginatedList = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // =========================
    // FILTER OBJECT
    // =========================
    const filter = {};

    // =========================
    // STATUS FILTER
    // =========================
    if (req.query.status !== undefined) {
      filter.status = req.query.status === "true";
    }

    // =========================
    // BRAND FILTER
    // =========================
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    // =========================
    // CATEGORY FILTER
    // =========================
    if (req.query.category) {
      filter.cat_id = req.query.category;
    }

    // =========================
    // COLLECTION FILTER
    // =========================
    if (req.query.collection) {
      filter.collection_id = req.query.collection;
    }

    // =========================
    // SUB BRAND FILTER
    // =========================
    if (req.query.subBrand) {
      filter.subBrand = req.query.subBrand;
    }

    // =========================
    // DATE FILTER
    // =========================
    const TIMEZONE = "Asia/Kolkata";

    if (req.query.startDate && req.query.endDate) {
      filter.updatedAt = {
        $gte: moment.tz(req.query.startDate, TIMEZONE).startOf("day").toDate(),

        $lte: moment.tz(req.query.endDate, TIMEZONE).endOf("day").toDate(),
      };
    }

    // =========================
    // FUZZY SEARCH
    // =========================
    if (req.query.search) {
      const search = req.query.search.trim();

      // Split by space or dash
      const tokens = search.split(/[\s-]+/).filter(Boolean);

      // Every token must match
      filter.$and = tokens.map((token) => ({
        $or: [
          {
            product_code: {
              $regex: token,
              $options: "i",
            },
          },

          {
            name: {
              $regex: token,
              $options: "i",
            },
          },

          {
            sku_group_id: {
              $regex: token,
              $options: "i",
            },
          },

          {
            sku_group__name: {
              $regex: token,
              $options: "i",
            },
          },

          {
            product_hsn_code: {
              $regex: token,
              $options: "i",
            },
          },
        ],
      }));
    }

    // =========================
    // SORTING
    // =========================
    // Whitelist of fields the client is allowed to sort by.
    // Keys = value sent from frontend (?sortBy=...), values = actual schema path.
    // This protects against arbitrary/unindexed/invalid sort fields being
    // passed straight into the query from the client.
    const SORTABLE_FIELDS = {
      product_code: "product_code",
      name: "name",
      sku_group_id: "sku_group_id",
      sku_group__name: "sku_group__name",
      pack: "pack",
      product_type: "product_type",
      product_valuation_type: "product_valuation_type",
      product_hsn_code: "product_hsn_code",
      cgst: "cgst",
      sgst: "sgst",
      igst: "igst",
      uom: "uom",
      no_of_pieces_in_a_box: "no_of_pieces_in_a_box",
      status: "status",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    const requestedSortBy = req.query.sortBy;
    const sortField = SORTABLE_FIELDS[requestedSortBy] || "updatedAt";

    const requestedSortOrder = (req.query.sortOrder || "").toLowerCase();
    const sortOrder = requestedSortOrder === "asc" ? 1 : -1;

    const sortOptions = { [sortField]: sortOrder };

    // Tie-breaker so pagination order stays stable when many rows share
    // the same value for the chosen sort field.
    if (sortField !== "_id") {
      sortOptions._id = -1;
    }

    // =========================
    // TOTAL COUNT
    // =========================
    const totalCount = await Product.countDocuments({});

    // =========================
    // FILTERED COUNT
    // =========================
    const filteredCount = await Product.countDocuments(filter);

    // =========================
    // PRODUCT LIST
    // =========================
    const products = await Product.find(filter)
      .populate([
        {
          path: "cat_id",
        },
        {
          path: "collection_id",
        },
        {
          path: "brand",
        },
        {
          path: "subBrand",
        },
        {
          path: "supplier",
        },
      ])
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    // =========================
    // RESPONSE
    // =========================
    return res.status(200).json({
      status: 200,
      message: "Product paginated list",
      data: products,

      sort: {
        sortBy:
          requestedSortBy && SORTABLE_FIELDS[requestedSortBy]
            ? requestedSortBy
            : "updatedAt",
        sortOrder: sortOrder === 1 ? "asc" : "desc",
      },

      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalItems: totalCount,
      },
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      status: 500,
      message: error.message,
    });
  }
});

module.exports = {
  createProduct,
  productDetail,
  updateProduct,
  productAllList,
  productPaginatedList,
};
