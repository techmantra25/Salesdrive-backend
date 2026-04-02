const mongoose = require("mongoose");

const distributorTransactionSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    retailerOutletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RetailerOutletTransaction",
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    transactionFor: {
      type: String,
      enum: [
        "GRN",
        "SALES",
        "Sales Multiplier",
        "Sales Return",
        "Purchase Return",
        "Opening Points",
        "Manual Stock Point",
        "Adjustment Point",
        "other",
      ],
      required: true,
    },
    point: {
      type: Number,
      required: true,
    },
    balance: {
      type: Number,
      required: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
    },
    salesReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesReturn",
    },
    purchaseReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseReturn",
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    status: {
      type: String,
      enum: ["Success", "Failed", "Pending", "Skipped"],
      default: "Pending",
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    remark: {
      type: String,
      default: "",
    },
    apiResponse: {
      type: Object,
      default: null,
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

// Ensure unique SALES transaction per bill
distributorTransactionSchema.index(
  {
    billId: 1,
    transactionFor: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      transactionFor: "SALES",
    },
  },
);

distributorTransactionSchema.index(
  { invoiceId: 1, transactionFor: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionFor: "GRN",
    },
  },
);

const DistributorTransaction = mongoose.model(
  "DistributorTransaction",
  distributorTransactionSchema,
);

module.exports = DistributorTransaction;
