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
      values: ["pcs", "bndl", "box", "coil"],
      message: "Values allowed pcs/box/bndl/coil",
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
  oderQty: {
    type: Number,
    default: 0,
  },
  boxOrderQty: {
    type: Number,
    default: 0,
  },
  totalDiscountAmount: {
    type: Number,
    default: 0,
  },

  totalDiscountPercentage: {
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
  usedBasePoint: { type: Number, default: null },
  goodsType: {
    type: String,
    enum: ["Billed"],
  },
});

const OrderEnquirySchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    enquiryNo: {
      type: String,
      required: true,
      unique: true,
    },
    salesmanName: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    routeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Beat",
    },
    retailerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
    },
    orderType: {
      type: String,
      enum: ["Counter", "Normal-Sale"],
      required: true,
    },
    orderSource: {
      type: String,
      enum: ["SFA", "Distributor", "Retailer", "Telecaller", "SAP"],
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ["Cash", "Credit"],
      required: true,
    },
    lineItems: [LineItemSchema],
    totalLines: {
      type: Number,
      default: 0,
    },
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
    freightCharges: {
      type: Number,
      default: 0,
    },

    handlingCharges: {
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
    cashDiscountApplied: {
      type: Boolean,
      default: false,
    },
    cashDiscountType: {
      type: String,
      enum: ["amount", "percent"],
      default: "amount",
    },
    cashDiscountValue: {
      type: Number,
      default: 0,
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      default: 0,
    },
    adjustedCreditNoteIds: [
      {
        creditNoteId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "CreditNote",
        },
        adjustedAmount: {
          type: Number,
          default: 0,
        },
      },
    ],
    status: {
      type: String,
      enum: ["Pending", "Converted", "Cancelled"],
      default: "Pending",
    },
    remark: {
      type: String,
    },
    convertedOrderEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderEntry",
    },
    convertedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

const OrderEnquiry = mongoose.model("OrderEnquiry", OrderEnquirySchema);

module.exports = OrderEnquiry;
