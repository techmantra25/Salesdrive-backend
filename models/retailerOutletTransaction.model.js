const mongoose = require("mongoose");

const retailerOutletSchema = new mongoose.Schema(
  {
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    distributorTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DistributorTransaction",
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    transactionFor: {
      type: String,
      enum: [
        "SALES",
        "Sales Multiplier",
        "Volume Multiplier",
        "Consistency Multiplier",
        "Bill Volume Multiplier",
        "Multiplier Sales Return",
        "Sales Return",
        "Opening Points",
        "Manual Point",
        "Gift Redemption",
        "Gift Order Cancellation",
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
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
    },
    salesReturnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesReturn",
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
    },
    giftRedemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GiftOrder",
    },
    status: {
      type: String,
      enum: ["Success", "Failed", "Pending", "Skipped"],
      default: "Pending",
    },
    remark: {
      type: String,
      default: "",
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
retailerOutletSchema.index(
  {
    billId: 1,
    transactionFor: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      transactionFor: "SALES",
      status: "Success",
    },
  },
);

// Ensure unique transaction per sales return
retailerOutletSchema.index(
  {
    salesReturnId: 1,
    transactionFor: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      transactionFor: "Sales Return",
      status: "Success",
    },
  },
);

retailerOutletSchema.index(
  { retailerId: 1, createdAt: 1, _id: 1 },
  { name: "retailer_timeline_idx" },
);

retailerOutletSchema.index(
  { createdAt: 1, _id: 1 },
  { name: "global_timeline_idx" },
);

const RetailerOutletTransaction = mongoose.model(
  "RetailerOutletTransaction",
  retailerOutletSchema,
);

module.exports = RetailerOutletTransaction;
