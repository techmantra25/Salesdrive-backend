const mongoose = require("mongoose");

const dbRule = new mongoose.Schema(
  {
    dbId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    module: {
      type: String,
      enum: ["Invoice T&C"],
      required: true,
      trim: true,
    },
    rules: {
      type: [String],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const DBRule = mongoose.model("DbRule", dbRule);

module.exports = DBRule;
