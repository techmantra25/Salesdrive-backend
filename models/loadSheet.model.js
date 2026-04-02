const mongoose = require("mongoose");

const loadSheetSchema = new mongoose.Schema(
  {
    allocationNo: {
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
    billIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Bill",
        required: true,
      },
    ],
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    deliveryBoyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      required: true,
    },
    beatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Beat",
      required: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    printUrl: {
      url: {
        type: String,
      },
      lastUpdated: {
        type: Date,
      },
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const LoadSheet = mongoose.model("LoadSheet", loadSheetSchema);

module.exports = LoadSheet;
