const mongoose = require("mongoose");

const pageSchema = new mongoose.Schema(
  {
    module: {
      type: String,
      required: true, // Parent Module like "Inventory", "Sales"
    },

    page: {
      type: String,
      required: true, // Child Page like "Stock Report", "Outlet Lead"
    },

    slug: {
      type: String,
      required: true,
      unique: true, // stock-report, outlet-lead
    },

    permissions: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      update: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
    },

    order: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// prevent duplicate module + page
pageSchema.index({ module: 1, page: 1 }, { unique: true });

module.exports = mongoose.model("PageMaster", pageSchema);
