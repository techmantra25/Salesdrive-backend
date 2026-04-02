const mongoose = require("mongoose");

const LineItemSchema = new mongoose.Schema({
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Bill",
    required: true,
  },
  discountAmount: {
    type: Number,
  },
  collectionAmount: {
    type: Number,
  },
  collectionMode: {
    type: String,
    enum: ["cash", "cheque", "bank_transfer", "upi"],
    required: true,
  },
  cash: {
    collectionDate: {
      type: Date,
    },
    collectionBy: {
      type: String,
    },
  },
  cheque: {
    chequeNumber: {
      type: String,
    },
    chequeDate: {
      type: Date,
    },
    bankName: {
      type: String,
    },
    collectionDate: {
      type: Date,
    },
    collectionBy: {
      type: String,
    },
  },
  bank_transfer: {
    transactionId: {
      type: String,
    },
    bankName: {
      type: String,
    },
    bankIFSC: {
      type: String,
    },
    transferType: {
      type: String,
    },
    collectionDate: {
      type: Date,
    },
    collectionBy: {
      type: String,
    },
  },
  upi: {
    upiId: {
      type: String,
    },
    transactionId: {
      type: String,
    },
    collectionDate: {
      type: Date,
    },
    collectionBy: {
      type: String,
    },
  },
  creditNoteAdjusted: [
    {
      creditNoteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CreditNote",
      },
      amount: {
        type: Number,
      },
    },
  ],
  remarks: {
    type: String,
  },
});

const ledgerCollectionSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    collectionNo: {
      type: String,
      required: true,
    },
    collectionType: {
      type: String,
      enum: ["bill_wise", "retailer_wise"],
      required: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    totalCollectionAmount: {
      type: Number,
    },
    totalDiscountAmount: {
      type: Number,
    },
    totalCreditNoteAmount: {
      type: Number,
    },
    totalAmountByCollection: {
      // totalAmountByCollection = totalCollectionAmount + totalDiscountAmount + totalCreditNoteAmount
      type: Number,
    },
    lineItems: [LineItemSchema],
  },
  {
    timestamps: true,
  }
);

const LedgerCollection = mongoose.model(
  "LedgerCollection",
  ledgerCollectionSchema
);

module.exports = LedgerCollection;
