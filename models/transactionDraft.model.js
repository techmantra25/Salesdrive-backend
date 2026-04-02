const mongoose = require("mongoose");

const transactionDraftItemSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    invItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
    },
    qty: {
      type: Number,
      required: true, // Quantity is required
    },
    date: {
      type: Date,
    },
    type: {
      type: String,
      enum: ["In", "Out"], // Only allow "In" or "Out"
    },
    description: {
      type: String,
      trim: true, // Remove extra spaces
    },
    stockType: {
      type: String,
      enum: ["salable", "unsalable", "offer"],
    },
  },
  { _id: false } // Disable individual _id for each transaction item
);

const transactionDraftSchema = new mongoose.Schema(
  {
    draft_data: [transactionDraftItemSchema], // Array of draft items
    transactionDraftId: {
      type: String,
      required: true, // Unique transaction draft ID
    },
  },
  {
    timestamps: true, // Automatically adds `createdAt` and `updatedAt`
  }
);

const TransactionDraft = mongoose.model(
  "TransactionDraft",
  transactionDraftSchema
);

module.exports = TransactionDraft;
