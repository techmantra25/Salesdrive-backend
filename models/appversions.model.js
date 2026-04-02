const mongoose = require("mongoose");

const appVersionSchema = new mongoose.Schema(
  {
    androidVersionCode: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AppVersion = mongoose.model("AppVersion", appVersionSchema);

module.exports = AppVersion;
