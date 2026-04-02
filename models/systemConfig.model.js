const mongoose = require("mongoose");

const systemConfigSchema = new mongoose.Schema(
  {
    job: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    cronTime: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

module.exports = mongoose.model("SystemConfig", systemConfigSchema);
