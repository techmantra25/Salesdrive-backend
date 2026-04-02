const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    invitemId: {
      type: String,
      //unique: true,  // TODO: Uncomment this once we have a unique code generator
      required: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
    },
    intransitQty: {
      type: Number,
      default: 0,
    },
    undeliveredQty: {
      type: Number,
      default: 0,
    },
    damagedQty: {
      type: Number,
      default: 0,
    },
    availableQty: {
      // salable qty according to new changes
      type: Number,
      default: 0,
      min: [0, "availableQty cannot be less then 0"],
    },
    reservedQty: {
      type: Number,
      default: 0,
      min: [0, "reservedQty cannot be less then 0"],
    },
    unsalableQty: {
      type: Number,
      default: 0,
    },
    offerQty: {
      type: Number,
      default: 0,
    },
    totalQty: {
      type: Number,
      default: 0,
    },
    totalStockamtDlp: {
      // salableDlp
      type: Number,
      default: 0,
    },
    totalStockamtRlp: {
      // salableRlp
      type: Number,
      default: 0,
    },
    totalUnsalableamtDlp: {
      // unsalableDlp
      type: Number,
      default: 0,
    },
    totalUnsalableStockamtRlp: {
      // unsalableRlp
      type: Number,
      default: 0,
    },
    normsQty: {
      type: Number,
      default: 0,
    },
    godownType: {
      type: String,
    },
    openingStock: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

inventorySchema.index({ distributorId: 1, availableQty: 1 });
inventorySchema.index({ distributorId: 1, productId: 1, godownType: 1 });

const Inventory = mongoose.model("Inventory", inventorySchema);

module.exports = Inventory;
