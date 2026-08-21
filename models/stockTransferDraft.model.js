const mongoose = require("mongoose");

const stockTransferDraftItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    product_code: {
      type: String,
      trim: true,
    },
    product_name: {
      type: String,
      trim: true,
    },
    stockType: {
      type: String,
      enum: ["salable", "unsalable", "offer", "reserve", "intransit"],
      required: true,
    },
    godownIdFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },
    godownIdTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },
    qty: {
      type: Number,
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const stockTransferDraftSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
      index: true,
    },
    transferDraftId: {
      type: String,
      required: true, // e.g. from transactionCode("LXSTD") for drafts
      index: true,
    },
    godownIdFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },
    godownIdTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },
    draft_data: [stockTransferDraftItemSchema],
    status: {
      type: String,
      enum: ["Draft", "Submitted"],
      default: "Draft",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
  },
  {
    timestamps: true,
  }
);

const StockTransferDraft = mongoose.model(
  "StockTransferDraft",
  stockTransferDraftSchema
);

module.exports = StockTransferDraft;