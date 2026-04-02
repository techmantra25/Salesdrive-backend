const asyncHandler = require("express-async-handler");
const SubBrand = require("../../models/subBrand.model");

//create subBrand

const createSubBrand = asyncHandler(async (req, res) => {
  try {
    const { name, image_path, desc, brandId, slug, status } = req.body;

    let subBrandExist = await SubBrand.findOne({ name: req.body.name });

    if (subBrandExist) {
      res.status(400);
      throw new Error("SubBrand already exists");
    }

    const subBrandData = await SubBrand.create({
      name,
      code: req.body.name,
      image_path,
      desc,
      brandId,
    });

    return res.status(201).json({
      status: 201,
      message: "SubBrand created successfully",
      data: subBrandData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createSubBrand,
};
