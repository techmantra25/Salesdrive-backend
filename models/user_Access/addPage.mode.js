const mongoose = require("mongoose");

const pageSchema = new mongoose.Schema(
  {
    module: {
      type: String,
      required: true,
      trim: true,
    },

    page: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    permissions: {
      view: {
        type: Boolean,
        default: false,
      },
      create: {
        type: Boolean,
        default: false,
      },
      update: {
        type: Boolean,
        default: false,
      },
      delete: {
        type: Boolean,
        default: false,
      },
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
  {
    timestamps: true, // createdAt & updatedAt auto
  }
);

module.exports = mongoose.model("Page", pageSchema);