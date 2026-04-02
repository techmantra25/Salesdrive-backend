const mongoose = require("mongoose");

const LineItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  plant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Plant",
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
  lineItemUOM: {
    type: String,
  },
  // order qty in selected lineItemUOM (keep in mind: that this is not box order qty it is order qty in selected uom)
  boxOrderQty: {
    type: Number,
    default: 0,
  },
  // order qty in pcs (base uom)
  oderQty: {
    type: Number,
    default: 0,
  },
  grossAmt: {
    type: Number,
    default: 0,
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
});

const PurchasOrderEntrySchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    selectedBrand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
    },
    selectedPlant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plant",
    },
    purchaseOrderNo: {
      type: String,
      required: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
    },
    expectedDeliveryDate: {
      type: Date,
      // required: true,
    },

    lineItems: [LineItemSchema],
    totalLines: {
      type: Number,
      default: 0,
    },

    grossAmount: {
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
    netAmount: {
      type: Number,
      default: 0,
    },
    totalGSTAmount: {
      type: Number,
      default: 0,
    },
    remarks: {
      type: String,
    },
    status: {
      type: String,
      enum: ["Draft", "Cancelled", "Confirmed"],
      default: "Draft",
    },
    approvedStatus: {
      type: String,
      enum: ["Approved", "Not Approved", "Rejected"],
      default: "Not Approved",
    },
    rejectedReason: {
      type: String,
    },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "approvedByType",
    },
    approvedByType: {
      type: String,
      enum: ["Employee", "User", "Distributor"],
    },
    updatedByType: {
      type: String,
      enum: ["Distributor", "Employee", "User"],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "updatedByType",
    },
    quotationResponse: {
      type: Object,
    },
    quotationSuccess: {
      type: Boolean,
      default: false,
    },
    orderRemark: {
      type: String,
      default: "",
    },
    sapStatus: {
      type: String,
      default: "Not Fetched",
    },
    sapStatusData: {
      type: Object,
      default: {},
    },
    totalBasePoints: { type: Number, default: null },
  },

  {
    timestamps: true,
  }
);

const PurchaseOrderEntry = mongoose.model(
  "PurchaseOrderEntry",
  PurchasOrderEntrySchema
);

module.exports = PurchaseOrderEntry;
