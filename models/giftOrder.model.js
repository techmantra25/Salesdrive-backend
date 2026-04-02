const mongoose = require("mongoose");

const giftOrderSchema = new mongoose.Schema(
  {
    // 🔹 Retailer Info
    retailer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RetailerLogin",
      required: true,
    },

    retatilerRealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      alias: "retailerRealId",
      required: true,
    },

    // 🔹 Order Meta
    orderId: {
      type: String,
      required: true,
      unique: true,
    },

    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart",
    },

    // 🔹 Order Items (Snapshot)
    orderItems: [
      {
        cartItemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "CartGiftProduct",
          required: true,
        },

        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "GiftProduct",
          required: true,
        },

        productName: {
          type: String,
          required: true,
        },

        productImage: {
          type: [String],
          default: [],
        },

        pointsPerUnit: {
          type: Number,
          required: true,
          min: 0,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        totalPoints: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    // 🔹 Totals
    totalQuantity: {
      type: Number,
      required: true,
      min: 0,
    },

    totalRedemptionPoints: {
      type: Number,
      required: true,
      min: 0,
    },

    // 🔹 Shipping Info (NEW)
    shippingInfo: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RetailerLogin",
        required: true,
      },

      shippingAddress: {
        type: String,
        required: true,
      },

      shippingLandmark: {
        type: String,
      },

      shippingCity: {
        type: String,
        required: true,
      },

      shippingState: {
        type: String,
        required: true,
      },

      shippingCountry: {
        type: String,
        required: true,
      },

      shippingPin: {
        type: String,
        required: true,
      },
    },

    // 🔹 Order Status
    status: {
      type: String,
      enum: [
        "Waiting for NOC",
        "NOC Approved",
        "Address Confirmed",
        "Gift Ordered",
        "Gift Dispatched",
        "Gift Delivered",
        "Cancelled",
      ],
      default: "Waiting for NOC",
    },
    statusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        remark: {
          type: String,
        },
        updatedStatusDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // 🔹 Dispatch Details
    dispatchInfo: {
      docketNumber: String,
      dispatchDate: Date,
      ExpecteddeliveryDate: Date,
      dispatchRemark: String,
    },

    // 🔹 Delivery Details
    deliveryInfo: {
      deliveryDate: Date,
      deliveryRemark: String,
    },

    // 🔹 Cancellation Details
    cancellationInfo: {
      cancelledAt: Date,
      reason: String,
    },
  },
  {
    timestamps: true,
  }
);

const GiftOrder = mongoose.model("GiftOrder", giftOrderSchema);

module.exports = GiftOrder;
