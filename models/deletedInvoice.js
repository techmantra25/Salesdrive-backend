const mongoose = require("mongoose");

const deletedInvoiceSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
    },
    invoiceNo: {
      type: String,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    originalInvoiceData: {
      type: Object,
    },
    deletedDbTransactions: {
      type: [Object],
      default: [],
    },
    deletedApiTransactions: {
      type: [Object],
      default: [],
    },
    deletedRetailerMultiplierTransactions: {
      type: [Object],
      default: [],
    },
    deletedRetailerOutletTransactions: {
      type: [Object],
      default: [],
    },
    rebuildResult: {
      type: Object,
    },
  },
  {
    timestamps: true,
  }
);

const DeletedInvoice = mongoose.model("DeletedInvoice", deletedInvoiceSchema);

module.exports = DeletedInvoice;
