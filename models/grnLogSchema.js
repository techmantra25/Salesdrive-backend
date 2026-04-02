const mongoose = require("mongoose");

const grnLogSchema = new mongoose.Schema(
  {
    Grn_Id: {
      // Invoice Number (VbelnBill)
      type: String,
      required: true,
      unique: true,
    },
    GrnData: {
      type: Object,
    },
    SearchKey: {
      type: String,
      default: function () {
        return JSON.stringify(this.GrnData || {});
      },
    },
    GrnStatus: {
      type: String,
      enum: ["Import_Success", "Import_Failed", "Issue_Resolved"],
    },
    ErrorLog: {
      type: String,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },
  },
  {
    timestamps: true,
  }
);

const GrnLOG = mongoose.model("GrnLOG", grnLogSchema);

module.exports = GrnLOG;
