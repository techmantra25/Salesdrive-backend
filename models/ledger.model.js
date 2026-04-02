const mongoose = require("mongoose");

const LedgerSchema = new mongoose.Schema(
  {
    dbId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    transactionId: {
      type: String,
      required: true,
      trim: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    transactionType: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    // Sales -> debit, Collection -> credit, Credit Note -> debit, Debit Note -> credit
    transactionFor: {
      type: String,
      enum: [
        "Sales",
        "Sales-Credit-Adjustment",
        "Collection",
        "Credit Note",
        "Debit Note",
        "Opening Balance",
        "Collection-Discount",
        "Collection-Credit-Adjustment",
      ],
      required: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      required: function () {
        return this.transactionFor === "Sales";
      },
      default: null,
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerCollection",
      required: function () {
        return (
          this.transactionFor === "Collection" ||
          this.transactionFor === "Collection-Discount"
        );
      },
      default: null,
    },
    creditNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CreditNote",
      required: function () {
        return this.transactionFor === "Credit Note";
      },
      default: null,
    },
    debitNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DebitNote",
      required: function () {
        return this.transactionFor === "Debit Note";
      },
      default: null,
    },
    transactionAmount: {
      type: Number,
      required: true,
    },
    balance: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Ledger = mongoose.model("Ledger", LedgerSchema);

module.exports = Ledger;
