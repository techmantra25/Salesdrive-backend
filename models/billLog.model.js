const mongoose = require("mongoose");

const billLogSchema = new mongoose.Schema(
  {
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      required: true,
    },
    lineItemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    event: {
      type: String,
      enum: ["NEGATIVE_BILL_QTY", "NEGATIVE_ORDER_QTY", "RACE_CONDITION_SUSPECTED"],
      required: true,
    },
    triggeredBy: {
      type: String,
      required: true,
    },
    beforeQty: {
      type: Number,
      default: null,
    },
    afterQty: {
      type: Number,
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed, 
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

//  auto clean after 30day
billLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
billLogSchema.index({ billId: 1 });

const BillLog = mongoose.model("BillLog", billLogSchema);

module.exports = BillLog;