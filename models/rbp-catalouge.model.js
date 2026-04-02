const mongoose = require("mongoose");

const rbpCatalogueSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
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

const RBPCatalogue = mongoose.model("RBPCatalogue", rbpCatalogueSchema);

module.exports = RBPCatalogue;