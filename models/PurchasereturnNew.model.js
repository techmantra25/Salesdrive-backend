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

    // --- Pricing snapshot (server-recomputed at save time, never trusted
    // verbatim from the client) ---
    mrp: {
      type: Number,
      default: 0,
    },
    l1BasicPercent: {
      type: Number,
      default: 0,
    },
    basicRate: {
      // Per-unit rate after L1 discount, i.e. mrp - (mrp * l1BasicPercent / 100)
      type: Number,
      default: 0,
    },
    taxableAmount: {
      // basicRate * returnQty, rounded to 2 decimals
      type: Number,
      default: 0,
    },
    cgstPercent: {
      type: Number,
      default: 0,
    },
    sgstPercent: {
      type: Number,
      default: 0,
    },
    igstPercent: {
      type: Number,
      default: 0,
    },
    gstAmount: {
      type: Number,
      default: 0,
    },
    netAmount: {
      // taxableAmount + gstAmount
      type: Number,
      default: 0,
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

    // Whether IGST applies to this return (vs CGST+SGST). Drives which
    // gst percent is used when computing gstAmount per line item.
    isIGST: {
      type: Boolean,
      default: false,
    },

    lineItems: {
      type: [purchaseReturnLineItemSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one line item is required",
      },
    },

    // --- Totals (server-recomputed sum of lineItems, not trusted from client) ---
    totalQty: {
      type: Number,
      default: 0,
    },
    totalTaxableAmount: {
      type: Number,
      default: 0,
    },
    totalGstAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
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