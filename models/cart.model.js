const mongoose = require("mongoose");
const CartGiftProduct = require("./cartGiftProduct.model");

const cartSchema  = new mongoose.Schema(
  {
    retailer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RetailerLogin",
      required: true,
    },
    retatilerRealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    totalQuantity: {
      type: Number,
      default: 0,
    },
    totalPoints: {
      type: Number,
      default: 0,
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

const Cart = mongoose.model("Cart", cartSchema);

module.exports = Cart;
    