const mongoose = require("mongoose");

const retailerMultiplierShadowRunSchema = new mongoose.Schema(
  {
    month: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    selectionType: {
      type: String,
      enum: ["single", "multiple", "all"],
      required: true,
    },
    requestedRetailerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "OutletApproved",
      },
    ],
    requestedRetailerCount: {
      type: Number,
      default: 0,
    },
    requestSignature: {
      type: String,
      required: true,
      index: true,
    },
    multiplierType: {
      type: String,
      enum: ["all", "monthly", "consistency"],
      default: "all",
    },
    batchSize: {
      type: Number,
      default: 100,
    },
    status: {
      type: String,
      enum: ["Pending", "Running", "Incomplete", "Completed"],
      default: "Pending",
    },
    totalRetailers: {
      type: Number,
      default: 0,
    },
    pendingRetailers: {
      type: Number,
      default: 0,
    },
    processingRetailers: {
      type: Number,
      default: 0,
    },
    completedRetailers: {
      type: Number,
      default: 0,
    },
    skippedRetailers: {
      type: Number,
      default: 0,
    },
    failedRetailers: {
      type: Number,
      default: 0,
    },
    processedRetailers: {
      type: Number,
      default: 0,
    },
    attemptedRetailers: {
      type: Number,
      default: 0,
    },
    currentBatchNumber: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

retailerMultiplierShadowRunSchema.index({ requestSignature: 1, createdAt: -1 });

const RetailerMultiplierShadowRun = mongoose.model(
  "RetailerMultiplierShadowRun",
  retailerMultiplierShadowRunSchema,
);

module.exports = RetailerMultiplierShadowRun;
