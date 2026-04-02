const mongoose = require("mongoose");

const dbBankSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    bankName: {
      type: String,
    },
    branchCode: {
      type: String,
    },
    accountType: {
      type: String,
      enum: ["Savings", "Current", "Other"],
      default: null, // set defaul null value
    },
    accountNumber: {
      type: String,
    },
    ifscCode: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const DbBank = mongoose.model("DbBank", dbBankSchema);

module.exports = DbBank;
