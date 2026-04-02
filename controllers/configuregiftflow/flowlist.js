const asyncHandler = require("express-async-handler");
const ConfigureGiftOrderFlow = require("../../models/ConfigureGiftOrderFLow");

/**
 * Get gift order flow configuration
 */
const getGiftOrderFlow = asyncHandler(async (req, res) => {
  try {
    let config = await ConfigureGiftOrderFlow.findOne({});

    // If no config exists, create default one
    if (!config) {
      config = await ConfigureGiftOrderFlow.create({
        settings: {
          directDistributorCancel: false,
        },
      });
    }

    return res.status(200).json({
      status: 200,
      error: false,
      message: "Gift order flow configuration fetched successfully",
      data: config,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = getGiftOrderFlow;
