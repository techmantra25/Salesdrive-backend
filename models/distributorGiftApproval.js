const mongoose = require("mongoose");

const distributorGiftApprovalSchema = new mongoose.Schema(
  {
    giftOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GiftOrder",
      required: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    requestedPoints: {
      type: Number,
      required: true,
    },
    approvedPoints: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    remark: {
      type: String,
      default: "",
    },
    // Track source of approval request
    source: {
      type: String,
      enum: ["transaction", "beatMapping"],
      required: true,
      default: "transaction",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "DistributorGiftApproval",
  distributorGiftApprovalSchema
);
