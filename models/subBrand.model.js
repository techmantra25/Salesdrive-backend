const mongoose = require("mongoose");

const subBrandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      required: true,
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
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
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

const SubBrand = mongoose.model("SubBrand", subBrandSchema);

module.exports = SubBrand;
