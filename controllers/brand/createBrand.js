const asyncHandler = require("express-async-handler");
const Brand = require("../../models/brand.model");
// const { generateCode } = require("../../utils/codeGenerator");

//create brand

const createBrand = asyncHandler(async (req, res) => {
  try {
    const { name, image_path, desc } = req.body;

    let brandExist = await Brand.findOne({ name: req.body.name });

    if (brandExist) {
      res.status(400);
      throw new Error("Brand already exists");
    }

    const brandData = await Brand.create({
      name,
      code: req.body.name,
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

module.exports = {
  createBrand,
};
