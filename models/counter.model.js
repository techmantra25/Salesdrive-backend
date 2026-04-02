const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  codeType: { type: String, required: true },
  yearRange: { type: String },
  seq: { type: Number, default: 0 },
  distributorId: { type: mongoose.Schema.Types.ObjectId, ref: "Distributor" },
});

const Counter = mongoose.model("Counter", counterSchema);

module.exports = Counter;
