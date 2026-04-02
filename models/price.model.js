const mongoose = require("mongoose");

const priceSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      require: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      require: true,
    },
    price_type: {
      type: String,
      enum: {
        values: ["regional", "distributor", "national"],
        message: "values allowed regional/distributor/national",
      },
      default: "regional",
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      require: function () {
        return this.price_type !== "national";
      },
    },
    mrp_price: {
      type: String,
      require: true,
    },
    dlp_price: {
      type: String,
      default: null,
    },
    rlp_price: {
      type: String,
      default: null,
    },
    effective_date: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      require: false,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      require: false,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

priceSchema.index({
  status:1,
  distributorId:1,
  regionId:1,
  price_type:1,
  productId:1
})

const Price = mongoose.model("Price", priceSchema);

module.exports = Price;
