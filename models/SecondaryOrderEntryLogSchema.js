const mongoose = require("mongoose");

const SecondaryOrderEntryLogSchema = new mongoose.Schema(
  {
    Order_Id: {
      type: String,
      required: true,
      unique: true,
    },
    OrderData: {
      type: Object,
    },
    OrderStatus: {
      type: String,
      enum: ["Import_Success", "Import_Failed", "Issue_Resolved"],
    },
    ErrorLog: {
      type: String,
    },
    searchKey: {
      type: String,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderEntry",
    },
  },
  {
    timestamps: true,
  }
);

const SecondaryOrderEntryLog = mongoose.model(
  "SecondaryOrderEntryLog",
  SecondaryOrderEntryLogSchema
);

module.exports = SecondaryOrderEntryLog;
