const asyncHandler = require("express-async-handler");
const SubBrand = require("../../models/subBrand.model");

const subBrandList = asyncHandler(async (req, res) => {
  try {
    let subBrandList = await SubBrand.find({})
      .populate("brandId")
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All SubBrand list",
      data: subBrandList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  subBrandList,
};
