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
      product_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      subBrand,
      // supplier,
      size,
      color,
      pack,
      std_pkg_in_pc,
      wp_pc,
      name,
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
      product_code: req.body.product_code,
    });

    if (productExist) {
      res.status(400);
      throw new Error("Product already exists");
    }
console.log(req.body)
    const productData = await Product.create({
      product_code,
      sku_group_id,
      sku_group__name,
      cat_id,
      collection_id,
      brand,
      subBrand,
      // supplier,
      size,
      color,
      pack,
      std_pkg_in_pc,
      wp_pc,
      name,
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
      { path: "subBrand", select: "" }, // ✅ changed
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
    const productId = req.params.proId;
    console.log("Updating product with ID:", productId);

    // ✅ STATUS VALIDATION
    if (req.body.hasOwnProperty("status") && req.body.status === true) {
      const activePriceExists = await Price.findOne({
        productId: productId,
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

    // ✅ PAYLOAD
    const payload = {
      product_code: req.body.product_code,
      name: req.body.name,

      sku_group_id: req.body.sku_group_id,
      sku_group__name: req.body.sku_group__name,

      cat_id: req.body.cat_id,
      collection_id: req.body.collection_id,
      brand: req.body.brand,
      subBrand: req.body.subBrand,

      supplier: req.body.supplier,

      size: req.body.size,
      color: req.body.color,
      pack: req.body.pack,

      std_pkg_in_pc: req.body.std_pkg_in_pc,
      wp_pc: req.body.wp_pc,

      img_path: req.body.img_path,

      collection_product_type: req.body.collection_product_type,
      product_valuation_type: req.body.product_valuation_type,
      product_hsn_code: req.body.product_hsn_code,

      cgst: req.body.cgst,
      sgst: req.body.sgst,
      igst: req.body.igst,

      sbu: req.body.sbu,
      base_point: req.body.base_point,

      uom: req.body.uom,
      ean11: req.body.ean11,

      status: req.body.status,
    };

    console.log("Payload for update:", payload);

    // ✅ FIX: REMOVE undefined, null, "" (IMPORTANT)
    Object.keys(payload).forEach((key) => {
      if (
        payload[key] === undefined ||
        payload[key] === null ||
        payload[key] === ""
      ) {
        delete payload[key];
      }
    });

    // ❌ LOCK FIELD
    delete payload.product_code;

    // ✅ REQUIRED VALIDATION
    if (!payload.name) {
      return res.status(400).send({
        error: true,
        message: "Name is required",
      });
    }

    if (!payload.cat_id) {
      return res.status(400).send({
        error: true,
        message: "Category is required",
      });
    }

    if (!payload.brand) {
      return res.status(400).send({
        error: true,
        message: "Brand is required",
      });
    }

    if (!payload.collection_id) {
      return res.status(400).send({
        error: true,
        message: "Collection is required",
      });
    }

    // ✅ UPDATE
    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      payload,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedProduct) {
      return res.status(404).send({
        error: true,
        message: "Product not found",
      });
    }

    return res.status(200).send({
      error: false,
      message: "Product updated successfully",
      data: updatedProduct,
    });
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
        { path: "subBrand", select: "" }, // ✅ changed
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

    if (req.query.subBrand) {
      filter.subBrand = req.query.subBrand;
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
        { product_code: searchRegex },
        { name: searchRegex },
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
        { path: "subBrand", select: "" },
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
        product_code: obj.product_code || obj.product_code,
        name: obj.name || obj.name,
        subBrand: obj.subBrand || obj.subBrand,
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