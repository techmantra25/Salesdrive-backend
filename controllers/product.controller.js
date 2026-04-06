const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const Product = require("../models/product.model");
const Category = require("../models/category.model");
const Collection = require("../models/collection.model");
const Brand = require("../models/brand.model");
const Price = require("../models/price.model");

/**
 * ✅ CREATE PRODUCT
 */
const createProduct = asyncHandler(async (req, res) => {
  try {
    const {
      s4hana_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      segment,
      // supplier,
      size,
      color,
      pack,
      std_pkg_in_pc,
      wp_pc,
      description,
      img_path,
      collection_product_type,
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
      s4hana_code: req.body.s4hana_code,
    });

    if (productExist) {
      res.status(400);
      throw new Error("Product already exists");
    }
console.log(req.body)
    const productData = await Product.create({
      s4hana_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      segment,
      // supplier,
      size,
      color,
      pack,
      std_pkg_in_pc,
      wp_pc,
      description,
      img_path,
      collection_product_type,
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

/**
 * ✅ PRODUCT DETAIL
 */
const productDetail = asyncHandler(async (req, res) => {
  try {
    let productData = await Product.findOne({
      _id: req.params.proId,
    }).populate([
      { path: "cat_id", select: "" },
      { path: "collection_id", select: "" },
      { path: "brand", select: "" },
      { path: "segment", select: "" }, // ✅ changed
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

/**
 * ✅ UPDATE PRODUCT (NO LOGIC CHANGE)
 */


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

    if (req.body.hasOwnProperty("status") && req.body.status === true) {
      const activePriceExists = await Price.findOne({
        productId: req.params.proId,
        status: true,
      });

      if (!activePriceExists) {
        return res.status(400).send({
          error: true,
          message:
            "Cannot activate product. No active price found for this product.",
        });
      }
    }

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

/**
 * ✅ ALL PRODUCT LIST
 */
const productAllList = asyncHandler(async (req, res) => {
  try {
    let productList = await Product.find({})
      .populate([
        { path: "cat_id", select: "" },
        { path: "collection_id", select: "" },
        { path: "brand", select: "" },
        { path: "segment", select: "" }, // ✅ changed
        // { path: "supplier", select: "" },
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

/**
 * ✅ PAGINATED LIST
 */
const productPaginatedList = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.status !== undefined) {
      filter.status = req.query.status === "true";
    }

    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    if (req.query.category) {
      filter.cat_id = req.query.category;
    }

    if (req.query.collection) {
      filter.collection_id = req.query.collection;
    }

    if (req.query.segment) {
      filter.segment = req.query.segment;
    }

    const TIMEZONE = "Asia/Kolkata";

    if (req.query.startDate && req.query.endDate) {
      filter.updatedAt = {
        $gte: moment.tz(req.query.startDate, TIMEZONE).startOf("day").toDate(),
        $lte: moment.tz(req.query.endDate, TIMEZONE).endOf("day").toDate(),
      };
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");

      filter.$or = [
        { s4hana_code: searchRegex },
        { description: searchRegex },
        { sku_group_id: searchRegex },
        { sku_group__name: searchRegex },
        { product_hsn_code: searchRegex },
        { ean11: searchRegex },

        // ✅ SUPPORT OLD DATA ALSO
        { product_code: searchRegex },
        { name: searchRegex },
      ];
    }

    const totalCount = await Product.countDocuments(filter);
    const filteredCount = totalCount;

    const products = await Product.find(filter)
      .populate([
        { path: "cat_id", select: "" },
        { path: "collection_id", select: "" },
        { path: "brand", select: "" },
        { path: "segment", select: "" },
      ])
      .sort({ createdAt: -1 }) // ✅ better sorting
      .skip(skip)
      .limit(limit);

    // ✅🔥 MAIN FIX — NORMALIZE DATA
    const normalizedProducts = products.map((item) => {
      const obj = item.toObject();

      return {
        ...obj,

        // NEW STRUCTURE (fallback from old)
        s4hana_code: obj.s4hana_code || obj.product_code,
        description: obj.description || obj.name,
        segment: obj.segment || obj.subBrand,
        std_pkg_in_pc: obj.std_pkg_in_pc || obj.no_of_pieces_in_a_box,

        // optional cleanup
        product_code: undefined,
        name: undefined,
        subBrand: undefined,
        no_of_pieces_in_a_box: undefined,
      };
    });

    return res.status(200).json({
      status: 200,
      message: "Product paginated list",
      data: normalizedProducts, // ✅ FIXED
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