const mongoose = require("mongoose");

const reasonSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      required: true,
    },
    module: {
      type: String,
      enum: [
        "Order-To-Bill",
        "Order-Cancellation",
        "Bill-Cancellation",
        "Sales-Return",
        "Purchase-Order-Cancellation",
        "Purchase-Return",
      ],
      required: true,
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

const Reason = mongoose.model("Reason", reasonSchema);

module.exports = Reason;
