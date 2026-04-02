const mongoose = require("mongoose");

const secondaryTargetSlabSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    slab_type: {
      type: String,
      enum: ["volume", "value", "percentage"],
      required: true,
    },
    targets: [
      //all the targets that are connected to this slab
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SecondaryTarget",
      },
    ],
    //it is necessary that when we set the slab type as the value or volume we must make sure that the max and the min range are set
    min_range: {
      type: Number,
      // required: true,
    },
    max_range: {
      type: Number,
      // required: true,
    },
    perc_slab: {
      // will be set only in case whe type of the slab is percentage
      type: Number,
    },
    discount: {
      type: Number,
      min: 0,
      max: 100,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    slabCode: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: true },
);

secondaryTargetSlabSchema.index({ slab_type: 1, is_active: 1 });

const SecondaryTargetSlab = mongoose.model(
  "SecondaryTargetSlab",
  secondaryTargetSlabSchema,
);
module.exports = SecondaryTargetSlab;
