const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      index: true, // Create an index on this field
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      index: true, // Create an index on this field
    },
    transactionId: {
      type: String,
      index: true, // Create an index on this field
    },
    invItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
      index: true, // Create an index on this field
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      default: null,
      index: true,
    },
    billLineItemId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    qty: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      required: true,
      index: true, // Create an index on this field
    },
    type: {
      type: String,
      enum: ["In", "Out"],
      required: true,
      index: true, // Create an index on this field
    },
    balanceCount: {
      type: Number,
    },
    description: {
      type: String,
    },
    transactionType: {
      type: String,
      enum: [
        "openingstock",
        "stockadjustment",
        "invoice",
        "stocktransfer",
        "delivery",
        "salesreturn",
        "purchasereturn",
      ],
    },
    stockType: {
      type: String,
      enum: ["salable", "unsalable", "offer", "reserve"],
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      index: true,
    },
    invoiceLineItemId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    dates: {
      deliveryDate: {
        type: Date,
        default: null,
      },
      originalDeliveryDate: {
        type: Date,
        default: null,
      },
    },
    enabledBackDate: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

transactionSchema.index(
  {
    invoiceId: 1,
    invoiceLineItemId: 1,
    transactionType: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      transactionType: "invoice",
    },
  },
);

transactionSchema.index(
  {
    billId: 1,
    billLineItemId: 1,
    productId: 1,
    invItemId: 1,
    type: 1,
    transactionType: 1,
  },
  {
    unique: true,
    sparse:true,//added sparse index so duplicate transaction could be avoided
    partialFilterExpression: {
      type: "Out",
      transactionType: { $in: ["delivery", "salesreturn"] },
    },
  },
);

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
