const asyncHandler = require("express-async-handler");
const AppVersion = require("../../models/appversions.model");

const updateAppVersion = asyncHandler(async (req, res) => {
  try {
    // Proceed with the app version update
    let updatedAppVersion = await AppVersion.findOneAndUpdate(
      { _id: req.params.appVersionId },
      req.body,
      { new: true }
    );

    if (updatedAppVersion) {
      return res.status(200).json({
        status: 200,
        message: "App version updated successfully",
        data: updatedAppVersion,
      });
    } else {
      return res.status(404).json({
        status: 404,
        message: "App version not found",
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateAppVersion };
