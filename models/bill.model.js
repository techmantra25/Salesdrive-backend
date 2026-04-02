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
  },
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
  },
  oderQty: {
    type: Number,
    default: 0,
    min: [0, "bill quantity can not be less then 0"],
  },
  boxOrderQty: {
    type: Number,
    default: 0,
    min: [0, "boxOrderQty cannot be negative"],
  },
  billQty: {
    type: Number,
    default: 0,
    min: [0, "bill quantity can not be less then 0"],
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
  remark: {
    type: String,
  },
  itemBillType: {
    type: String,
    enum: [
      "Item Added",
      "Item Removed",
      "Partial",
      "Full",
      "Qty Added",
      "Replacement",
      "Stock Out"
    ],
  },
  goodsType: {
    type: String,
    enum: ["Billed", "Replacement"],
  },
  usedBasePoint: { type: Number, default: null },

  // Adjustment tracking
  adjustmentStatus: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "pending",
  },
  adjustmentError: {
    type: String,
    default: null,
  },
  adjustmentAttempts: {
    type: Number,
    default: 0,
  },
  lastAdjustmentAttempt: {
    type: Date,
    default: null,
  },
  // If true -> this item is not retriable (stock-out / invalid data / permanently missing inventory)
  adjustmentNonRetriable: {
    type: Boolean,
    default: false,
  },
});

const BillSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    new_billseriesid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "new_billSeries",
      default: null,
    },
    new_billno: {
      type: String,
      default: null,
    },
    billNo: {
      type: String,
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderEntry",
      required: true,
    },
    // target id
    targetId:{
      type:mongoose.Schema.Types.ObjectId,
      ref:"SecondaryTarget"
    },
    orderNo: {
      type: String,
      required: true,
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
    printUrl: {
      url: {
        type: String,
      },
      lastUpdated: {
        type: Date,
      },
    },
    billedType: {
      type: String,
      enum: ["Bulk", "Single"],
      default: "Single",
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
    adjustedReplacementIds: [
      {
        replacementId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Replacement",
        },
        adjustedQty: {
          type: Number,
          default: 0,
        },
      },
    ],
    status: {
      type: String,
      enum: [
        "Pending",
        "Delivered",
        "Cancelled",
        "Vehicle Allocated",
        "Partially-Delivered",
      ],
      default: "Pending",
    },
    dates: {
      deliveryDate: {
        type: Date,
        default: null,
      },
      originalDeliveryDate: {
        type: Date,
        default: null,
      },
      cancelledDate: {
        type: Date,
        default: null,
      },
    },
    enabledBackDate: {
      type: Boolean,
      default: false,
    },
    billRemark: {
      type: String,
    },
    loadSheetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoadSheet",
    },
    creditNoteId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "CreditNote",
      default: [],
    },
    replacementId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Replacement",
      default: [],
    },
    salesReturnId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "SalesReturn",
      default: [],
    },
    ledgerCollectionId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LedgerCollection",
      },
    ],
    ledgerCollectionStatus: {
      type: String,
      enum: ["Pending Payment", "Completely Paid", "Partially Paid"],
      default: "Pending Payment",
    },

    adjustmentSummary: {
      totalProducts: { type: Number, default: 0 },
      successfulAdjustments: { type: Number, default: 0 },
      failedAdjustments: { type: Number, default: 0 },
      lastRetryAttempt: { type: Date, default: null },
    },
    
  },
  {
    timestamps: true,
  },
);

const Bill = mongoose.model("Bill", BillSchema);

module.exports = Bill;
