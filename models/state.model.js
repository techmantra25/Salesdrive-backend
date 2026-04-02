const mongoose = require("mongoose");

const stateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    code: {
      //  gst code
      type: String,
      required: true,
      unique: true,
    },
    slug: {
      // state sort code / alpha code
      type: String,
      required: true,
      unique: true,
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
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

const State = mongoose.model("State", stateSchema);

module.exports = State;
