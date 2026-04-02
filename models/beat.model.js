const mongoose = require("mongoose");

const beatSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
    },
    beatIds: {
      type: [String],
      required: false,
      default: [],
    },
    beat_type: {
      type: String,
      enum: ["split", "normal"],
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      required: true,
    },
    isOccupied: {
      type: Boolean,
      default: false,
      required: false,
    },
    employeeId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Employee",
    },
    status: {
      type: Boolean,
      default: true,
    },
    distributorId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Distributor",
    },
  },
  {
    timestamps: true,
  }
);

beatSchema.index({distributorId:1});

const Beat = mongoose.model("Beat", beatSchema);

module.exports = Beat;
