const asyncHandler = require("express-async-handler");
const Brand = require("../../models/brand.model");

// detail

const detailBrand = asyncHandler(async (req, res) => {
  try {
    let brandData = await Brand.findOne({ _id: req.params.brandId });
    return res.status(201).json({
      status: 201,
      message: "All Brand Detail",
      data: brandData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  detailBrand,
};
