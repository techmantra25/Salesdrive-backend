const asyncHandler = require("express-async-handler");
const SubBrand = require("../../models/subBrand.model");

// detail

const detailSubBrand = asyncHandler(async (req, res) => {
  try {
    let subBrandData = await SubBrand.findOne({ _id: req.params.subBrandId }).populate("brandId");
    return res.status(201).json({
      status: 201,
      message: "All SubBrand Detail",
      data: subBrandData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  detailSubBrand,
};
