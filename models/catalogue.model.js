const mongoose = require("mongoose");

const urlSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "image", "video"],
      required: true,
    },
  },
  { _id: false }
);

const catalogueSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    url: [urlSchema],
    status: {
      type: String,
      enum: ["draft", "active", "inactive"],
      default: "draft",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Catalogue", catalogueSchema);
