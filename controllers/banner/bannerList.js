const asyncHandler = require("express-async-handler");
const Banner = require("../../models/banner.model");

const bannerList = asyncHandler(async (req, res) => {
  try {
    // Get all banners for the distributor
    const banners = await Banner.find();

    // Return the banners
    return res.status(200).json({
      status: 200,
      message: "Banners retrieved successfully",
      data: banners,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Assuming the distributorId is stored in req.user from the authentication middleware

module.exports = { bannerList };
