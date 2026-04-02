const mongoose = require("mongoose");

const primaryTargetSlabSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    slab_type: {
      type: String,
      enum: ["volume", "value","percentage"],
      required: true,
    },
    slabUid: {
  type: String,
  unique: true,
},
    min_range: {
      type: Number,
     
    },
    max_range: {
      type: Number,
      
    },
      total_percentage: {
      type: Number,  
    },

    discount_percentage: {
      type: Number,
    },
   targetIds:[
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PrimaryTarget",
    required: true,
  }
],
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

primaryTargetSlabSchema.index({ slab_type: 1, is_active: 1, distributorId: 1, name: 1, });

const PrimaryTargetSlab = mongoose.model(
  "PrimaryTargetSlab",
  primaryTargetSlabSchema,
);
module.exports = PrimaryTargetSlab;
