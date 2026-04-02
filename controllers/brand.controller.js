const asyncHandler = require("express-async-handler");
const Brand = require("../models/brand.model");
const Product = require("../models/product.model");
const { generateCode } = require("../utils/codeGenerator");

const createBrand = asyncHandler(async (req, res) => {
  try {
    const { name, image_path, desc } = req.body;

    let brandExist = await Brand.findOne({ name: req.body.name });

    if (brandExist) {
      res.status(400);
      throw new Error("Brand already exists");
    }

    const BrandCode = await generateCode("B-LX");

    const brandData = await Brand.create({
      name,
      code: BrandCode,
      image_path,
      desc,
    });

    return res.status(201).json({
      status: 201,
      message: "Brand created successfully",
      data: brandData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// detail

const brandDetail = asyncHandler(async (req, res) => {
  try {
    let brandData = await Brand.findOne({ _id: req.params.brandId });
    return res.status(201).json({
      status: 201,
      message: "All Brand Data",
      data: brandData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// update

// const updateBrand = asyncHandler(async (req, res) => {
//   try {
//     let brandList = await Brand.findOneAndUpdate(
//       { _id: req.params.brandId },
//       req.body,
//       { new: true }
//     );
//     if (brandList) {
//       message = {
//         error: false,
//         message: "Brand updated successfully",
//         data: brandList,
//       };
//       return res.status(200).send(message);
//     } else {
//       message = {
//         error: true,
//         message: "Brand not upadated",
//       };
//       return res.status(500).send(message);
//     }
//   } catch (error) {
//     res.status(400);
//     throw new Error(error?.message || "Something went wrong");
//   }
// });

const updateBrand = asyncHandler(async (req, res) => {
  try {
    // Check if the Brand ID is present in the Product model
    const productWithBrand = await Product.findOne({
      brand: req.params.brandId,
    });

    let message;

    if (productWithBrand && req.body.hasOwnProperty("status")) {
      // If the Brand is present in the Product model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "Brand is present in the Product model, status cannot be updated",
      };
    }

    // Proceed with the brand update
    let brandList = await Brand.findOneAndUpdate(
      { _id: req.params.brandId },
      req.body,
      { new: true }
    );

    if (brandList) {
      if (!message) {
        message = {
          error: false,
          message: "Brand updated successfully",
          data: brandList,
        };
      } else {
        message.data = brandList;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Brand not updated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const brandList = asyncHandler(async (req, res) => {
  try {
    let brandList = await Brand.find({}).sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Brand list",
      data: brandList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});
module.exports = {
  createBrand,
  brandDetail,
  updateBrand,
  brandList,
};
