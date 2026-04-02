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
      ean11,

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
      ean11,
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


//old code 
// const updateProduct = asyncHandler(async (req, res) => {
//   try {
//     console.log(req.params.proId)
//     // Check if the Product ID is present in the Price model
//     const pricetWithProduct = await Price.findOne({
//       productId: req.params.proId,
//     });

//     let message;

//     // if (pricetWithProduct && req.body.hasOwnProperty("status")) {
//     //   // If the Product is present in the Price model, remove the status field from the update payload
//     //   delete req.body.status;
//     //   message = {
//     //     error: false,
//     //     statusUpdateError: true,
//     //     message:
//     //       "Product is present in the Price model, status cannot be updated",
//     //   };
//     // }

//     if(req.body.hasOwnProperty("status") && req.body.status === true){
//       const activePriceExists = await Price.findOne({
//         productId:req.params.prodId,
//         status:true,
//       })
//       if(!activePriceExists){
//         return res.status(400).send({
//           error:true,
//           message:"Cannot activate product. No active price found for this product"
//         })
//       }
//     }

//     // Proceed with the Category update
//     let productList = await Product.findOneAndUpdate(
//       { _id: req.params.proId },
//       req.body,
//       { new: true }
//     );

//     if (productList) {
//       if (!message) {
//         message = {
//           error: false,
//           message: "Product updated successfully",
//           data: productList,
//         };
//       } else {
//         message.data = productList;
//       }
//       return res.status(200).send(message);
//     } else {
//       message = {
//         error: true,
//         message: "Product not updated",
//       };
//       return res.status(500).send(message);
//     }
//   } catch (error) {
//     res.status(400);
//     throw new Error(error?.message || "Something went wrong");
//   }
// });


const updateProduct = asyncHandler(async (req, res) => {
  try {
    let message;

    // Check if request is trying to activate the product (status: true)
    if (req.body.hasOwnProperty("status") && req.body.status === true) {
      // Check if there's at least one active price for this product
      const activePriceExists = await Price.findOne({
        productId: req.params.proId,
        status: true
      });

      if (!activePriceExists) {
        // No active price found - block the activation
        return res.status(400).send({
          error: true,
          message: "Cannot activate product. No active price found for this product."
        });
      }
    }

    // Proceed with the Product update
    let productList = await Product.findOneAndUpdate(
      { _id: req.params.proId },
      req.body,
      { new: true }
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

    // Build filter object
    const filter = {};

    // Status filter
    if (req.query.status !== undefined) {
      filter.status = req.query.status === "true";
    }

    // Brand filter
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    // Category filter
    if (req.query.category) {
      filter.cat_id = req.query.category;
    }

    // Collection filter
    if (req.query.collection) {
      filter.collection_id = req.query.collection;
    }

    // SubBrand filter
    if (req.query.subBrand) {
      filter.subBrand = req.query.subBrand;
    }

    const TIMEZONE = "Asia/Kolkata";

    // Date range filter on createdAt
    if (req.query.startDate && req.query.endDate) {
      filter.updatedAt = {
        $gte: moment.tz(req.query.startDate, TIMEZONE).startOf("day").toDate(),
        $lte: moment.tz(req.query.endDate, TIMEZONE).endOf("day").toDate(),
      };
      // const start = moment.tz(req.query.startDate, TIMEZONE).startOf("day").toDate();
      // const end = moment.tz(req.query.endDate, TIMEZONE).endOf("day").toDate();
      // filter.$or = [
      //   { createdAt: { $gte: start, $lte: end } },
      //   { updatedAt: { $gte: start, $lte: end } }
      // ];
    }
    // Search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { product_code: searchRegex },
        { name: searchRegex },
        { sku_group_id: searchRegex },
        { sku_group__name: searchRegex },
        { product_hsn_code: searchRegex },
        { ean11: searchRegex },
      ];
    }

    // Get total count without filters for pagination info
    const totalCount = await Product.countDocuments({});

    // Get filtered count
    const filteredCount = await Product.countDocuments(filter);

    // Get products with pagination
    const products = await Product.find(filter)
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
      .sort({ product_code: 1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      status: 200,
      message: "Product paginated list",
      data: products,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalItems: totalCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = {
  createProduct,
  productDetail,
  updateProduct,
  productAllList,
  productPaginatedList,
};
