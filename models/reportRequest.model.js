const mongoose = require("mongoose");

const reportRequestSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["Inventory", "Stock-Adjustment", "Opening-Stock", "order-entry"],
      required: true,
    },
    data: {
      type: Object,
      default: null,
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
      required: true,
    },
    error: {
      type: String,
      default: null,
    },
    reqBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "req_by_type",
    },
    req_by_type: {
      type: String,
      enum: ["User", "Distributor"],
    },
  },
  {
    timestamps: true,
  }
);

const ReportRequest = mongoose.model("ReportRequest", reportRequestSchema);

module.exports = ReportRequest;
