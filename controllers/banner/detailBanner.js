const asyncHandler = require("express-async-handler");
const Banner = require("../../models/banner.model");

// Assuming the bannerId is stored in req.params.bannerId from the URL route
const detailBanner = asyncHandler(async (req, res) => {
  try {
    const bannerId = req.params.bannerId;

    // Check if the banner with the given bannerId exists
    const banner = await Banner.findById(bannerId);

    if (!banner) {
      res.status(404);
      throw new Error("Banner not found");
    }

    // Return the banner data
    return res.status(200).json({
      status: 200,
      message: "Banner found",
      data: banner,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Assuming the bannerId is stored in req.params.bannerId from the URL route

module.exports = { detailBanner };
