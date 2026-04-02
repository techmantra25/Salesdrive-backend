const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    order_no: {
      type: Number,
      default: 0,
    },
    title: {
      type: String,
    },
    image: {
      type: String,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Banner = mongoose.model("Banner", bannerSchema);

module.exports = Banner;
