const mongoose = require("mongoose");

const billSeriesSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    count: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const BillSeries = mongoose.model("BillSeries", billSeriesSchema);

module.exports = BillSeries;
