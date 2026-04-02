const asyncHandler = require("express-async-handler");
const Banner = require("../../models/banner.model");

//creatrBanner
const createBanner = asyncHandler(async (req, res) => {
  try {
    const { order_no, title, image } = req.body;
    const bannerData = await Banner.create({
      order_no,
      title,
      image,
    });
    return res.status(201).json({
      status: 201,
      message: "Banner created successfully",
      data: bannerData,
    });
    `Bank`;
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createBanner };
