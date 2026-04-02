const mongoose = require("mongoose");

const cartgiftOrderSchema = new mongoose.Schema(
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
    cartId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Cart"
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GiftProduct",
    },
    quantity: {
      type: Number,
    },
    points: {
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

const CartGiftProduct = mongoose.model("CartGiftProduct", cartgiftOrderSchema);

module.exports = CartGiftProduct;
