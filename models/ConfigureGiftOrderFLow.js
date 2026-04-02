const mongoose = require("mongoose");

const configureGiftOrderFlowSchema = new mongoose.Schema(
  {
    // Settings object - will contain multiple configuration options
    settings: {
      directDistributorCancel: {
        type: Boolean,
        default: false,
      },
      // Future settings can be added here
    },
  },
  {
    timestamps: true,
  }
);

const ConfigureGiftOrderFlow = mongoose.model(
  "ConfigureGiftOrderFlow",
  configureGiftOrderFlowSchema
);

module.exports = ConfigureGiftOrderFlow;
