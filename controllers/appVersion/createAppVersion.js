const asyncHandler = require("express-async-handler");
const AppVersion = require("../../models/appversions.model");

const createAppVersion = asyncHandler(async (req, res) => {
  try {
    const { androidVersionCode, message } = req.body;

    // Check if an app version with the same androidVersionCode already exists
    let appVersionExist = await AppVersion.findOne({
      androidVersionCode: androidVersionCode,
    });

    if (appVersionExist) {
      res.status(400);
      throw new Error("App version with this Android version code already exists");
    }

    // Create new app version data (status defaults to true)
    const appVersionData = await AppVersion.create({
      androidVersionCode,
      message,
    });

    // Return successful response
    return res.status(201).json({
      status: 201,
      message: "App version created successfully",
      data: appVersionData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createAppVersion };
