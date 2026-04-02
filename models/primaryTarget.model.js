const mongoose = require("mongoose");

const primaryTargetSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },

    achivedTarget: {
      type: Number,
      required: true,
      default: 0,
    },

    target_type: {
      type: String,
      enum: ["volume", "value"],
      required: true,
    },

    targetValue: {
      type: Number,
      default: null,
      min: 0,
    },

    targetVolume: {
      type: Number,
      default: null,
      min: 0,
    },

    name: {
      type: String,
      required: true,
    },
    targetUid: {
  type: String,
  unique: true,
  required: true,
},

    isActive: {
      type: Boolean,
      default: true,
    },

    // DATE RANGE
    target_start_date: {
      type: Date,
      required: true,
    },

    target_end_date: {
      type: Date,
      required: true,
    },

    targetSlabId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PrimaryTargetSlab",
      },
    ],

    brandId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Brand",
        index: true,
      },
    ],

    subBrandId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubBrand",
      },
    ],

    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      default: null,
    },

    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
      default: null,
    },

    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      default: null,
    },

    approval_status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Approved",
    },

    reject_reason: {
      type: String,
      default: null,
    },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

primaryTargetSchema.index({
  distributorId: 1,
  name: 1,
  target_start_date: 1,
  target_end_date: 1,
});

module.exports = mongoose.model("PrimaryTarget", primaryTargetSchema);