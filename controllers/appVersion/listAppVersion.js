const asyncHandler = require("express-async-handler");
const AppVersion = require("../../models/appversions.model");

const listAppVersion = asyncHandler(async (req, res) => {
  try {
    // Fetch all app versions, sorted by _id in descending order
    let appVersions = await AppVersion.find({}).sort({
      _id: -1,
    });

    // Return the list of app versions
    return res.status(200).json({
      status: 200,
      message: "All App version list",
      data: appVersions,
    });
  } catch (error) {
    // Handle any errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listAppVersion };
