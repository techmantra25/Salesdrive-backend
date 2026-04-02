const asyncHandler = require("express-async-handler");
const GiftProduct = require("../models/giftProduct.model");
const { giftProductCodeGenerator } = require("../utils/codeGenerator");
const axios = require("axios");
const csv = require("csv-parser");
const mongoose = require("mongoose");

/**
 * Create a new gift product
 * @route POST /api/v1/gift-product/create-gift-product
 * @access Private/Admin
 */
const createGiftProduct = asyncHandler(async (req, res) => {
  try {
    const {
      name,
      description,
      searchTerm,
      image,
      point,
      specifications,
      status,
    } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      res.status(400);
      throw new Error("Name is required");
    }

    if (!description || description.trim() === "") {
      res.status(400);
      throw new Error("Description is required");
    }

    if (!image || !Array.isArray(image) || image.length === 0) {
      res.status(400);
      throw new Error("At least one image URL is required");
    }

    if (point === undefined || isNaN(point) || point < 0) {
      res.status(400);
      throw new Error("Valid point value is required");
    }

    // Check if gift product with same name already exists
    const existingProduct = await GiftProduct.findOne({ name: name.trim() });
    if (existingProduct) {
      res.status(400);
      throw new Error("Gift product with this name already exists");
    }

    // Validate specifications if provided
    if (specifications) {
      if (!Array.isArray(specifications)) {
        res.status(400);
        throw new Error("Specifications must be an array");
      }

      for (let i = 0; i < specifications.length; i++) {
        const spec = specifications[i];
        if (!spec.title || !spec.value) {
          res.status(400);
          throw new Error(
            `Specification at index ${i} must have title and value`
          );
        }
      }
    }

    // Validate status if provided
    if (status && !["draft", "active", "inactive"].includes(status)) {
      res.status(400);
      throw new Error("Status must be one of: draft, active, inactive");
    }

    // Generate unique code for the gift product
    const code = await giftProductCodeGenerator("GP");

    const newGiftProduct = await GiftProduct.create({
      name: name.trim(),
      code,
      description: description.trim(),
      searchTerm: searchTerm ? searchTerm.trim() : undefined,
      image,
      point,
      specifications: specifications || [],
      status: status || "draft",
    });

    return res.status(201).json({
      status: 201,
      message: "Gift product created successfully",
      data: newGiftProduct,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

/**
 * Get gift product detail by ID
 * @route GET /api/v1/gift-product/detail-gift-product/:id
 * @access Public
 */
const getGiftProductDetail = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid gift product ID");
    }

    const giftProduct = await GiftProduct.findById(id);

    if (!giftProduct) {
      return res.status(404).json({
        status: 404,
        message: "Gift product not found",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Gift product fetched successfully",
      data: giftProduct,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

/**
 * Update gift product
 * @route PATCH /api/v1/gift-product/update-gift-product/:id
 * @access Private/Admin
 */
const updateGiftProduct = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      searchTerm,
      image,
      point,
      specifications,
      status,
    } = req.body;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid gift product ID");
    }

    // Check if product exists
    const giftProduct = await GiftProduct.findById(id);
    if (!giftProduct) {
      return res.status(404).json({
        status: 404,
        message: "Gift product not found",
      });
    }

    // Validate inputs if provided
    if (name !== undefined) {
      if (name.trim() === "") {
        res.status(400);
        throw new Error("Name cannot be empty");
      }

      // Check for name uniqueness if it's being changed
      if (name !== giftProduct.name) {
        const existingProduct = await GiftProduct.findOne({
          name: name.trim(),
          _id: { $ne: id }, // Exclude current product
        });

        if (existingProduct) {
          res.status(400);
          throw new Error("Gift product with this name already exists");
        }
      }
    }

    if (description !== undefined && description.trim() === "") {
      res.status(400);
      throw new Error("Description cannot be empty");
    }

    if (searchTerm !== undefined && searchTerm.trim() === "") {
      res.status(400);
      throw new Error("Search term cannot be empty");
    }

    if (image !== undefined) {
      if (!Array.isArray(image) || image.length === 0) {
        res.status(400);
        throw new Error("At least one image URL is required");
      }
    }

    if (point !== undefined && (isNaN(point) || point < 0)) {
      res.status(400);
      throw new Error("Valid point value is required");
    }

    // Validate specifications if provided
    if (specifications !== undefined) {
      if (!Array.isArray(specifications)) {
        res.status(400);
        throw new Error("Specifications must be an array");
      }

      for (let i = 0; i < specifications.length; i++) {
        const spec = specifications[i];
        if (!spec.title || !spec.value) {
          res.status(400);
          throw new Error(
            `Specification at index ${i} must have title and value`
          );
        }
      }
    }

    // Validate status if provided
    if (
      status !== undefined &&
      !["draft", "active", "inactive"].includes(status)
    ) {
      res.status(400);
      throw new Error("Status must be one of: draft, active, inactive");
    }

    // Update fields if provided
    if (name) giftProduct.name = name.trim();
    if (description) giftProduct.description = description.trim();
    if (searchTerm) giftProduct.searchTerm = searchTerm.trim();
    if (image) giftProduct.image = image;
    if (point !== undefined) giftProduct.point = point;
    if (specifications !== undefined)
      giftProduct.specifications = specifications;
    if (status) giftProduct.status = status;

    await giftProduct.save();

    return res.status(200).json({
      status: 200,
      message: "Gift product updated successfully",
      data: giftProduct,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

/**
 * Get paginated list of gift products
 * @route GET /api/v1/gift-product/paginated-gift-product-list
 * @access Public
 */
const paginatedGiftProductList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      minPoints,
      maxPoints,
    } = req.query;

    // Validate pagination parameters
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (isNaN(parsedPage) || parsedPage < 1) {
      res.status(400);
      throw new Error("Page must be a positive number");
    }

    if (isNaN(parsedLimit) || parsedLimit < 1) {
      res.status(400);
      throw new Error("Limit must be a positive number");
    }

    // Build filter object
    const filter = {};

    // Filter by status if provided
    if (status) {
      if (!["draft", "active", "inactive"].includes(status)) {
        res.status(400);
        throw new Error(
          "Invalid status value. Must be one of: draft, active, inactive"
        );
      }
      filter.status = status;
    }

    // Filter by points range if provided
    if (minPoints !== undefined || maxPoints !== undefined) {
      filter.point = {};

      if (minPoints !== undefined) {
        const min = Number(minPoints);
        if (isNaN(min)) {
          res.status(400);
          throw new Error("Minimum points must be a number");
        }
        filter.point.$gte = min;
      }

      if (maxPoints !== undefined) {
        const max = Number(maxPoints);
        if (isNaN(max)) {
          res.status(400);
          throw new Error("Maximum points must be a number");
        }
        filter.point.$lte = max;
      }
    }

    // Search by name, description, or search term
    if (search && search.trim() !== "") {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { searchTerm: { $regex: search, $options: "i" } },
      ];
    }

    // Calculate total count
    const totalCount = await GiftProduct.countDocuments();
    const filteredCount = await GiftProduct.countDocuments(filter);

    // Get products with pagination
    const giftProducts = await GiftProduct.find(filter)
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit);

    return res.status(200).json({
      status: 200,
      message: "Gift products fetched successfully",
      data: giftProducts,
      pagination: {
        totalCount,
        filteredCount,
        totalPages: Math.ceil(totalCount / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const bulkAddGiftProduct = asyncHandler(async (req, res) => {
  let { file } = req.body;

  // ✅ Accept string or array
  if (!file) {
    return res.status(400).json({
      success: false,
      message: "CSV file URL is required",
    });
  }

  if (typeof file === "string") {
    file = [file];
  }

  if (!Array.isArray(file) || !file.length) {
    return res.status(400).json({
      success: false,
      message: "CSV file URL is required",
    });
  }

  const fileUrl = file[0];

  if (!fileUrl.toLowerCase().includes(".csv")) {
    return res.status(400).json({
      success: false,
      message: "Only CSV file is allowed",
    });
  }

  const rows = [];
  const successList = [];
  const skippedList = [];

  // 🔽 Download CSV
  const response = await axios({
    method: "get",
    url: fileUrl,
    responseType: "stream",
  });

  // 🔽 Parse CSV
  await new Promise((resolve, reject) => {
    response.data
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  // 🔽 Process rows
  for (const row of rows) {
    const name = row["Product Name"]?.trim();
    const description = row["Description"]?.trim();
    const point = Number(row["Points"]);
    const imageUrl = row["Image URL"]?.trim();

    // ✅ OPTIONAL STATUS
    let status = row["Status"]?.trim()?.toLowerCase();

    // validate enum
    if (!["draft", "active", "inactive"].includes(status)) {
      status = "draft";
    }

    // ❌ Validation
    if (!name || !description || isNaN(point) || !imageUrl) {
      skippedList.push({
        name: name || "N/A",
        reason: "Missing required fields",
      });
      continue;
    }

    if (point < 0) {
      skippedList.push({
        name,
        reason: "Points must be >= 0",
      });
      continue;
    }

    try {
      const code = await giftProductCodeGenerator("GP");

      await GiftProduct.create({
        name,
        code,
        description,
        point,
        image: [imageUrl],
        status, // ✅ from CSV OR default "draft"
      });

      successList.push({ name, point, status });
    } catch (error) {
      skippedList.push({
        name,
        reason: error.message,
      });
    }
  }

  // ✅ Response
  res.status(200).json({
    success: true,
    message: "Bulk upload completed successfully",
    summary: {
      totalRows: rows.length,
      successCount: successList.length,
      skippedCount: skippedList.length,
    },
    skippedData: skippedList,
  });
});

module.exports = {
  createGiftProduct,
  getGiftProductDetail,
  updateGiftProduct,
  paginatedGiftProductList,
  bulkAddGiftProduct,
};
