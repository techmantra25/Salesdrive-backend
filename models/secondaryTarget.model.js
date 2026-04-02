const mongoose = require("mongoose");
//secondary target schema
const secondaryTargetSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    currentTargetSlabId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SecondaryTargetSlab",
    },
    targetCode: {
      type: String,
      required: true,
      unique: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    targetSlabId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SecondaryTargetSlab",
        // required: true,
      },
    ],
    brandId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Brand",
        // required:true,
      },
    ],
    subBrandId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubBrand",
      },
    ],
    achivedTarget: {
      type: Number,
      required: true,
      default: 0, ///2000
    },
    returnedQty: {
      type: Number,
      default: 0,
    },
    name: {
      type: String,
      required: true,
      // unique:true,
    },
    target_type: {
      type: String,
      enum: ["volume", "value"],
      required: true,
    },
    target: {
      type: Number,
      required: true,
    },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
      required: true,
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      required: false,
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
      required: false,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
//indexing
secondaryTargetSchema.index({
  distributorId: 1,
  retailerId: 1,
  start_date: 1,
  end_date: 1,
});

const SecondaryTarget = mongoose.model(
  "SecondaryTarget",
  secondaryTargetSchema,
);
module.exports = SecondaryTarget;
