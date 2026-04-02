const mongoose = require("mongoose");

const plantSchema = new mongoose.Schema(
  {
    plantCode: {
      type: String,
      required: true,
      unique: true,
    },
    plantName: {
      type: String,
      required: true,
    },
    plantShortName: {
      type: String,
    },
    address: {
      type: String,
    },
    city: {
      type: String,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
    },
    pinCode: {
      type: String,
    },
    salesOrganisation: {
      type: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

const Plant = mongoose.model("Plant", plantSchema);

module.exports = Plant;
