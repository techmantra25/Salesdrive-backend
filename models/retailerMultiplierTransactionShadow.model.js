const mongoose = require("mongoose");

const retailerMultiplierTransactionShadowSchema = new mongoose.Schema(
  {
    recordType: {
      type: String,
      enum: ["transaction", "checkpoint"],
      default: "transaction",
      index: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    retailerCode: {
      type: String,
      default: "",
    },
    retailerName: {
      type: String,
      default: "",
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required() {
        return this.recordType === "transaction";
      },
    },
    transactionFor: {
      type: String,
      enum: [
        "Volume Multiplier",
        "Consistency Multiplier",
        "Bill Volume Multiplier",
        "Sales Return",
        "Other",
      ],
      required() {
        return this.recordType === "transaction";
      },
    },
    slabPercentage: {
      type: Number,
      required() {
        return this.recordType === "transaction";
      },
      default: null,
    },
    monthTotalPoints: {
      type: Number,
    },
    point: {
      type: Number,
      required() {
        return this.recordType === "transaction";
      },
      default: 0,
    },
    month: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    retailerOutletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RetailerOutletTransaction",
    },
    status: {
      type: String,
      enum: ["Success", "Failed", "Pending"],
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
    shadowMultiplierRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RetailerMultiplierShadowRun",
      default: null,
      index: true,
    },
    shadowRunId: {
      type: String,
      required: true,
    },
    runItemStatus: {
      type: String,
      enum: ["Pending", "Processing", "Completed", "Failed", "Skipped"],
      default: null,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    transactionsGenerated: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: null,
    },
    shadowRunResult: {
      type: Object,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

retailerMultiplierTransactionShadowSchema.index(
  {
    shadowMultiplierRunId: 1,
    retailerId: 1,
    recordType: 1,
  },
  {
    unique: true,
    partialFilterExpression: { recordType: "checkpoint" },
  },
);

retailerMultiplierTransactionShadowSchema.index({
  shadowMultiplierRunId: 1,
  recordType: 1,
  runItemStatus: 1,
  _id: 1,
});

const RetailerMultiplierTransactionShadow = mongoose.model(
  "RetailerMultiplierTransactionShadow",
  retailerMultiplierTransactionShadowSchema,
);

module.exports = RetailerMultiplierTransactionShadow;
