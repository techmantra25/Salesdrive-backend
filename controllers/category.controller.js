const asyncHandler = require("express-async-handler");
const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const { generateCode } = require("../utils/codeGenerator");

const createCategory = asyncHandler(async (req, res) => {
  try {
    const { name, image_path, brandId } = req.body;

    let categoryExist = await Category.findOne({ name: req.body.name });

    if (categoryExist) {
      res.status(400);
      throw new Error("Category already exists");
    }

    const CategoryCode = name;

    const categoryData = await Category.create({
      name,
      code: CategoryCode,
      image_path,
      brandId,
    });

    return res.status(201).json({
      status: 201,
      message: "Category created successfully",
      data: categoryData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const categoryDetail = asyncHandler(async (req, res) => {
  try {
    let categoryData = await Category.findOne({ _id: req.params.catId })
      .populate([
        {
          path: "brandId",
          select: "",
        },
      ])
      .sort({
        _id: -1,
      });
    return res.status(201).json({
      status: 201,
      message: "All category Data",
      data: categoryData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// update

const updateCategory = asyncHandler(async (req, res) => {
  try {
    // Check if the Category ID is present in the Product model
    const productWithcat = await Collection.findOne({
      cat_id: req.params.catId,
    });

    let message;

    if (productWithcat && req.body.hasOwnProperty("status")) {
      // If the Category is present in the Collection model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "Category is present in the Collection model, status cannot be updated",
      };
    }

    if (req.body.name) {
      const existingCategory = await Category.findOne({
        name: req.body.name,
        _id: { $ne: req.params.catId },
      });

      if (existingCategory) {
        res.status(400);
        throw new Error("Category with this name already exists");
      }

      req.body.code = req.body.name;
    }

    // Proceed with the Category update
    let categoryList = await Category.findOneAndUpdate(
      { _id: req.params.catId },
      req.body,
      { new: true }
    );

    if (categoryList) {
      if (!message) {
        message = {
          error: false,
          message: "Category updated successfully",
          data: categoryList,
        };
      } else {
        message.data = categoryList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Category not updated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const categoryList = asyncHandler(async (req, res) => {
  try {
    let categoryList = await Category.find({})
      .populate([
        {
          path: "brandId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All category list",
      data: categoryList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = {
  createCategory,
  categoryDetail,
  updateCategory,
  categoryList,
};
