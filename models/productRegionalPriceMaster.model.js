const mongoose = require("mongoose");

const productRegionalPriceMasterSchema = new mongoose.Schema(
  {
    Matnr: {
      type: String,
      required: false,
      trim: true,
    },
    Maktx: {
      type: String,
      required: false,
      trim: true,
    },
    Regio: {
      type: String,
      required: false,
      trim: true,
    },
    Bezei: {
      type: String,
      required: false,
      trim: true,
    },
    FromDate: {
      type: String,
      required: false,
      trim: true,
    },
    ToDate: {
      type: String,
      required: false,
      trim: true,
    },
    Kbetr: {
      type: String,
      required: false,
      trim: true,
    },
    Konwa: {
      type: String,
      required: false,
      trim: true,
    },
    Kpein: {
      type: String,
      required: false,
      trim: true,
    },
    Kmein: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const productRegionalPriceMaster = mongoose.model("productRegionalPriceMaster", productRegionalPriceMasterSchema);

module.exports = productRegionalPriceMaster;
