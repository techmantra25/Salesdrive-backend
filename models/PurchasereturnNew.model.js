const mongoose = require("mongoose");
const { Schema } = mongoose;

const purchaseReturnLineItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    returnQty: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const purchaseReturnSchema = new Schema(
  {
    // Human-readable unique code shown in the list screen (ele?.code)
    code: {
      type: String,
      required: true,
      unique: true,
    },

    distributorId: {
      type: Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },

    godownId: {
      type: Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },

    returnDate: {
      type: Date,
      default: Date.now,
    },

    lineItems: {
      type: [purchaseReturnLineItemSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one line item is required",
      },
    },

    // "Draft" = saved only, no stock movement.
    // "Returned" = stock has been (or will be, in the same transaction) deducted.
    status: {
      type: String,
      enum: ["Draft", "Returned"],
      default: "Draft",
      required: true,
    },

    returnRemark: {
      type: String,
      trim: true,
      maxlength: 95,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PurchaseReturnNew", purchaseReturnSchema);