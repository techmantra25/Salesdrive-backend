const mongoose = require("mongoose");

const LineItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  plant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Plant",
  },
  goodsType: {
    type: String,
    enum: ["billed", "free"], // free if amt 0
    required: true,
  },
  mrp: { type: Number }, // price
  qty: { type: Number },
  receivedQty: { type: Number },

  poNumber: { type: String },

  grossAmount: { type: Number },
  discountAmount: { type: Number, default: 0 }, // trade discount after + before
  specialDiscountAmount: { type: Number, default: 0 }, // special discount 1 + special discount 2
  taxableAmount: { type: Number }, //gross amount - all discount amount
  cgst: { type: Number, default: 0 }, // CGST amount
  sgst: { type: Number, default: 0 }, // SGST amount
  igst: { type: Number, default: 0 }, // IGST amount
  netAmount: { type: Number }, // taxableAmount + cgst + sgst + igst
  usedBasePoint: { type: Number, default: null },
  shortageQty: { type: Number, default: 0 },
  shortageUom: {
    type: String,
    default: "pcs",
    enum: {
      values: ["pcs", "box"],
      message: "values allowed pcs/box",
    },
  },
  damageQty: { type: Number, default: 0 },
  damageUom: {
    type: String,
    default: "pcs",
    enum: {
      values: ["pcs", "box"],
      message: "values allowed pcs/box",
    },
  },

  // NEW: Track adjustment status for each line item
  adjustmentStatus: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "pending",
  },
  adjustmentError: {
    type: String,
    default: null,
  },
  adjustmentAttempts: {
    type: Number,
    default: 0,
  },
  lastAdjustmentAttempt: {
    type: Date,
    default: null,
  },
});

const invoiceSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    invoiceNo: { type: String, required: true },
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["In-Transit", "Confirmed", "Ignored", "Partially-Adjusted"],
      default: "All",
      required: true,
    },
    targetIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "PrimaryTarget",
        },
      ],
      default: [],
    },
    grnDate: { type: Date, default: null }, // GRN Date generated after confirmation
    grnNumber: { type: String, default: null }, // GRN Number generated after confirmation
    shipping: {
      transporterName: { type: String },
      lrNo: { type: String },
      irnNo: { type: String },
    },
    lineItems: [LineItemSchema],

    grossAmount: { type: Number }, // Total gross amount
    tradeDiscount: { type: Number, default: 0 }, // trade discount after + before
    specialDiscountAmount: { type: Number, default: 0 }, // special discount 1 + special discount 2
    taxableAmount: { type: Number }, // gross amount - all discount amount
    cgst: { type: Number, default: 0 }, // CGST amount
    sgst: { type: Number, default: 0 }, // SGST amount
    igst: { type: Number, default: 0 }, // IGST amount
    invoiceAmount: { type: Number }, // taxableAmount + cgst + sgst + igst
    roundOff: { type: Number, default: 0 }, // round off amount
    totalInvoiceAmount: { type: Number }, // invoiceAmount + roundOff
    totalBasePoints: { type: Number, default: null },

    purchaseReturnIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "PurchaseReturn",
      default: [],
    },
    GRNLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GrnLOG",
      default: null,
    },
    GRNFKDATE: {
      type: Date,
      default: null,
    },
    grnStatus: {
      type: String,
      enum: ["pending", "success", "failed", "not-applicable"],
      default: "pending",
    },
    grnError: {
      type: String,
      default: null,
    },
    grnAttempts: {
      type: Number,
      default: 0,
    },
    lastGrnAttempt: {
      type: Date,
      default: null,
    },

    // NEW: Track overall adjustment status
    adjustmentSummary: {
      totalProducts: { type: Number, default: 0 },
      successfulAdjustments: { type: Number, default: 0 },
      failedAdjustments: { type: Number, default: 0 },
      lastRetryAttempt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;
