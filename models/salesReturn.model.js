const mongoose = require("mongoose");
const LineItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  uom: {
    type: String,
    enum: {
      values: ["pcs", "box"],
      message: "values allowed pcs/box",
    },
  },
  price: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Price",
    required: true,
  },
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
  },
  billQty: {
    type: Number,
    default: 0,
  },
  returnQty: {
    type: Number,
    default: 0,
  },
  grossAmt: {
    type: Number,
    default: 0,
  },
  schemeDisc: {
    type: Number,
    default: 0,
  },
  distributorDisc: {
    type: Number,
    default: 0,
  },
  distributorDiscUnit: {
    type: String,
    enum: ["percent", "amount"],
  },
  taxableAmt: {
    type: Number,
    default: 0,
  },
  totalCGST: {
    type: Number,
    default: 0,
  },
  totalSGST: {
    type: Number,
    default: 0,
  },
  totalIGST: {
    type: Number,
    default: 0,
  },
  netAmt: {
    type: Number,
    default: 0,
  },
  salesReturnRemark: {
    type: String,
    default: "",
  },
  salesReturnType: {
    type: String,
    enum: ["Credit Note", "Replacement", "No Credit Note"],
    required: true,
  },
  usedBasePoint: { type: Number, default: null },
});

const SalesReturn = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    salesReturnNo: {
      type: String,
      required: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      // required: true,
    },
    salesmanName: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    routeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Beat",
      required: true,
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    goodsType: {
      type: String,
      enum: ["Salable", "Unsalable"],
      required: true,
    },
    collectionStatus: {
      type: String,
    },
    remarks: {
      type: String,
    },
    lineItems: [LineItemSchema],
    totalBasePoints: {
      type: Number,
      default: 0,
    },
    grossAmount: {
      type: Number,
      default: 0,
    },
    schemeDiscount: {
      type: Number,
      default: 0,
    },
    distributorDiscount: {
      type: Number,
      default: 0,
    },
    taxableAmount: {
      type: Number,
      default: 0,
    },
    cgst: {
      type: Number,
      default: 0,
    },
    sgst: {
      type: Number,
      default: 0,
    },
    igst: {
      type: Number,
      default: 0,
    },
    invoiceAmount: {
      type: Number,
      default: 0,
    },
    roundOffAmount: {
      type: Number,
      default: 0,
    },
    cashDiscount: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      default: 0,
    },
    salesReturnDate: {
      type: Date,
      default: Date.now,
    },
    originalSalesReturnDate: {
      type: Date,
      default: null,
    },
    enabledBackDate: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

const SalesReturnModel = mongoose.model("SalesReturn", SalesReturn);

module.exports = SalesReturnModel;
