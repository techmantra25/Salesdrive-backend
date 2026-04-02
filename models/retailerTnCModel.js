const mongoose = require("mongoose");

const retailerTnCModel = new mongoose.Schema(
  {
    tnc: {
      type: [String],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const RetailerTnC = mongoose.model("RetailerTnC", retailerTnCModel);

module.exports = RetailerTnC;
