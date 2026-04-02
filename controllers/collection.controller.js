const asyncHandler = require("express-async-handler");
const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const Product = require("../models/product.model");
const { generateCode } = require("../utils/codeGenerator");

const createCollection = asyncHandler(async (req, res) => {
  try {
    const { name, cat_id, image_path, description } = req.body;

    let collectionExist = await Collection.findOne({
      $and: [{ name: req.body.name }, { cat_id: req.body.cat_id }],
    });

    if (collectionExist) {
      res.status(400);
      throw new Error("Collection already exists");
    }

    const CollectionCode = name;

    const collectionData = await Collection.create({
      name,
      code: CollectionCode,
      cat_id,
      image_path,
      description,
    });

    return res.status(201).json({
      status: 201,
      message: "Collection created successfully",
      data: collectionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const collectionDetail = asyncHandler(async (req, res) => {
  try {
    let collectionData = await Collection.findOne({
      _id: req.params.colId,
    }).populate([
      {
        path: "cat_id",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "All Collection Data",
      data: collectionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// update

const updateCollection = asyncHandler(async (req, res) => {
  try {
    // Check if the Collection ID is present in the Product model
    const productWithcoll = await Product.findOne({
      collection_id: req.params.colId,
    });

    let message;

    if (productWithcoll && req.body.hasOwnProperty("status")) {
      // If the Collection is present in the Product model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "Collection is present in the Product model, status cannot be updated",
      };
    }

    if (req.body.name) {
      const existingCollection = await Collection.findOne({
        name: req.body.name,
        _id: { $ne: req.params.colId },
      });

      if (existingCollection) {
        res.status(400);
        throw new Error("Collection name already exists");
      }
      req.body.code = req.body.name;
    }

    // Proceed with the Collection update
    let collectionList = await Collection.findOneAndUpdate(
      { _id: req.params.colId },
      req.body,
      { new: true }
    );

    if (collectionList) {
      if (!message) {
        message = {
          error: false,
          message: "collection updated successfully",
          data: collectionList,
        };
      } else {
        message.data = collectionList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "collection not updated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const coziCollectionList = asyncHandler(async (req, res) => {
  try {
    let collectionList = await Collection.find({
      cat_id: req.params.catId,
    })
      .populate([
        {
          path: "cat_id",
          select: "name",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Collection list",
      data: collectionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const coziCollectionAllList = asyncHandler(async (req, res) => {
  try {
    let collectionList = await Collection.find({})
      .populate([
        {
          path: "cat_id",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Collection list",
      data: collectionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = {
  createCollection,
  collectionDetail,
  updateCollection,
  coziCollectionList,
  coziCollectionAllList,
};
