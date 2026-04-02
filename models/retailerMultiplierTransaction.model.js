const mongoose = require("mongoose");

const retailerMultiplierTransactionModel = new mongoose.Schema(
  {
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
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
      required: true,
    },
    slabPercentage: {
      type: Number,
      required: true,
    },
    monthTotalPoints: {
      type: Number,
    },
    point: {
      type: Number,
      required: true,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      validate: {
        validator: Number.isInteger,
        message: "month must be an integer between 1 and 12",
      },
    },
    year: {
      type: Number,
      required: true,
      validate: {
        validator: function (v) {
          return (
            Number.isInteger(v) && v >= 2000 && v <= new Date().getFullYear()
          );
        },
        message: (props) => `${props.value} is not a valid year`,
      },
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
  },
  {
    timestamps: true,
  },
);

const RetailerMultiplierTransaction = mongoose.model(
  "RetailerMultiplierTransaction",
  retailerMultiplierTransactionModel,
);

module.exports = RetailerMultiplierTransaction;
