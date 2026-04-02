const mongoose = require("mongoose");

const priceCSVSchema = new mongoose.Schema(
  {
    url: {
      cronURL: {
        type: String,
        required: true,
      },
      modifiedURL: {
        type: String,
        required: false,
        default: null,
      },
    },
    count: {
      success: {
        type: Number,
        required: false,
        default: null,
      },
      failure: {
        type: Number,
        required: false,
        default: null,
      },
    },
    status: {
      type: String,
      enum: [
        "Pending",
        "Approved & Uploaded",
        "Canceled",
        "Modified & Uploaded",
      ],
      default: "Pending",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const PriceCSV = mongoose.model("PriceCSV", priceCSVSchema);

module.exports = PriceCSV;
