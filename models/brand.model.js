const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: [true, "Brand code must be unique"],
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: [true, "Brand code must be unique"],
      trim: true,
    },
    image_path: {
      type: String,
    },
    desc: {
      type: String,
    },
    slug: {
      type: String,
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Brand = mongoose.model("Brand", brandSchema);

module.exports = Brand;
