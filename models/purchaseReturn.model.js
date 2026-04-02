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
    enum: ["billed", "free"],
    required: true,
  },
  mrp: { type: Number },
  qty: { type: Number },
  returnedQty: { type: Number },
  poNumber: { type: String },

  grossAmount: { type: Number },
  discountAmount: { type: Number, default: 0 },
  specialDiscountAmount: { type: Number, default: 0 },
  taxableAmount: { type: Number },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  netAmount: { type: Number },
  usedBasePoint: { type: Number, default: null },
});

const purchaseReturnSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    lineItems: [LineItemSchema],

    grossAmount: { type: Number },
    tradeDiscount: { type: Number, default: 0 },
    specialDiscountAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    invoiceAmount: { type: Number },
    roundOff: { type: Number, default: 0 },
    totalInvoiceAmount: { type: Number },

    remarks: { type: String, default: "" },

    status: {
      type: String,
      enum: [
        "Return Requested",
        "Return Approved",
        "Return Rejected",
        "Return Completed",
      ],
      default: "Return Requested",
    },
     totalBasePoints: { type: Number, default: null },
  },
 
  {
    timestamps: true,
  }
);

const PurchaseReturn = mongoose.model("PurchaseReturn", purchaseReturnSchema);

module.exports = PurchaseReturn;
