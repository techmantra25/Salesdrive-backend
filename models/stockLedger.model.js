const mongoose = require("mongoose");
const Transaction = require("./transaction.model");

const stockLedgerSchema = new mongoose.Schema({
    distributorId:{
        type:mongoose.Schema.Types.ObjectId,
        ref: "Distributor",
        required:true,
        index:true,
    },
    productId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Product",
        required:true,
        index:true,
    },
    transactionId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:Transaction,
        required:true,
        index:true,
    },
    date:{
        type:Date,
        required:true,
        index:true,
    },
    openingStock:{
        type:Number,
        required:true,
        default:0,
    },
    openingPoints:{
        type:Number,
        required:true,
        default:0,
    },
    transactionType: {
      type: String,
      enum: [
        "openingstock",
        "stockadjustment",
        "invoice",
        "stocktransfer",
        "delivery",
        "salesreturn",
        "purchasereturn",
      ],
      required: true,
    },
    qtyChange:{
        type:Number,
        required:true,
        default:0,
    },
    pointChange:{
        type:Number,
        required:true,
        default:0,
    },
    closingStock:{
        type:Number,
        required:true,
        default:0,
    },
    closingPoints:{
        type:Number,
        required:true,
        default:0,
    }


},{
    timestamps:true,
});

const StockLedger = mongoose.model("StockLedger", stockLedgerSchema);

module.exports = StockLedger;
