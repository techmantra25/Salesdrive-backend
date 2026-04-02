const asyncHandler = require("express-async-handler");
const AppVersion = require("../../models/appversions.model");

const getLatestVersion = asyncHandler(async (req, res) => {
  try {
    // Find the latest active app version (status: true), sorted by creation date
    let latestVersion = await AppVersion.findOne({ status: true })
      .sort({ createdAt: -1 })
      .select("androidVersionCode message");

    if (!latestVersion) {
      return res.status(200).json({
        status: 200,
        message: "No app version found",
        data: null,
      });
    }

    // Return response in snake_case format
    return res.status(200).json({
      status: 200,
      android_version_code: latestVersion.androidVersionCode,
      message: latestVersion.message,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { getLatestVersion };
