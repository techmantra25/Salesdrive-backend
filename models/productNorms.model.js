const mongoose = require("mongoose");

const productNormsSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    salableQtyNorm: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const ProductNorms = mongoose.model("ProductNorms", productNormsSchema);
module.exports = ProductNorms;
