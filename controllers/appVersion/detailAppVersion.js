const asyncHandler = require("express-async-handler");
const AppVersion = require("../../models/appversions.model");

const detailAppVersion = asyncHandler(async (req, res) => {
  try {
    // Find the app version by the appVersionId from the request parameters
    let appVersionDetail = await AppVersion.findOne({
      _id: req.params.appVersionId,
    });

    if (!appVersionDetail) {
      res.status(404);
      throw new Error("App version not found");
    }

    // Return the app version details if found
    return res.status(200).json({
      status: 200,
      message: "App version details retrieved successfully",
      data: appVersionDetail,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailAppVersion };
