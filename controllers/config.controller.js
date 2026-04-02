const asyncHandler = require("express-async-handler");
const Config = require("../models/config.model");
const { getDefaultConfig } = require("../data/defaultConfig");

const upsertConfig = asyncHandler(async (req, res) => {
  try {
    const update = req.body;

    const config = await Config.findOneAndUpdate(
      {},
      { $set: update },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    res.status(200).json({
      status: 200,
      error: false,
      message: "Config updated successfully",
      data: config,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

const getConfig = asyncHandler(async (req, res) => {
  try {
    const config = await Config.findOne({});
    if (!config) {
      const defaultConfig = getDefaultConfig();
      const newConfig = await Config.create(defaultConfig);
      return res.status(200).json({
        status: 200,
        error: false,
        data: newConfig,
      });
    }
    res.status(200).json({
      status: 200,
      error: false,
      data: config,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = {
  upsertConfig,
  getConfig,
};
