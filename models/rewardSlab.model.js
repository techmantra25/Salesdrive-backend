const mongoose = require("mongoose");

const rewardSlabSchema = new mongoose.Schema(
  {
    slabType: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
    slabs: [
      {
        slabName: {
          type: String,
          required: true,
          trim: true,
        },
        description: {
          type: String,
          trim: true,
        },
        percentage: {
          type: Number,
          required: true,
          min: 0,
          max: 100,
        },
      },
    ],
    status: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

const RewardSlab = mongoose.model("RewardSlab", rewardSlabSchema);

module.exports = RewardSlab;
