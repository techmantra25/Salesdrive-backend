const asyncHandler = require("express-async-handler");
const ConfigureGiftOrderFlow = require("../../models/ConfigureGiftOrderFLow");

/**
 * Toggle direct distributor cancel boolean
 */
const toggleDirectDistributorCancel = asyncHandler(async (req, res) => {
  try {
    const { directDistributorCancel } = req.body;

    if (typeof directDistributorCancel !== "boolean") {
      return res.status(400).json({
        status: 400,
        error: true,
        message: "directDistributorCancel must be a boolean value",
      });
    }

    let config = await ConfigureGiftOrderFlow.findOne({});

    if (!config) {
      config = await ConfigureGiftOrderFlow.create({
        settings: {
          directDistributorCancel,
        },
      });
    } else {
      config.settings.directDistributorCancel = directDistributorCancel;
      await config.save();
    }

    return res.status(200).json({
      status: 200,
      error: false,
      message: "Direct distributor cancel setting updated successfully",
      data: config,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = toggleDirectDistributorCancel;
