const asyncHandler = require("express-async-handler");
const Brand = require("../../models/brand.model");

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
  brandList,
};
