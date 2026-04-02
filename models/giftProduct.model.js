const mongoose = require("mongoose");

const giftProduct = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    searchTerm: {
      type: String,
      required: false,
      trim: true,
    },
    image: {
      type: [String],
      required: true,
    },
    point: {
      type: Number,
      required: true,
    },
    specifications: {
      type: [
        {
          title: {
            type: String,
            required: true,
          },
          value: {
            type: String,
            required: true,
          },
        },
      ],
      required: false,
      default: [],
    },
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

const GiftProduct = mongoose.model("GiftProduct", giftProduct);

module.exports = GiftProduct;
