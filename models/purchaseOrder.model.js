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

  // ✅ ADDED (NEW FIELD)
  l1Basic: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },

  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
  },
  lineItemUOM: {
    type: String,
  },

  boxOrderQty: {
    type: Number,
    default: 0,
  },

  orderQty: {
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
    foreclose: {
      type: Boolean,
      default: false,
    },
    forecloseReason: {
      type: String,
      default: "",
    },
    invoiceIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Invoice",
        default: [],
      },
    ],
    invoicestatus: {
      type: String,
      enum: ["Pending", "Partially-Invoiced", "Complete-Invoiced"],
      default: "Pending",
    },

    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
    },
    soNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    expectedDeliveryDate: {
      type: Date,
    },

    lineItems: [LineItemSchema],

    totalLines: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    totalGSTAmount: { type: Number, default: 0 },

    remarks: { type: String },
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
    rejectedReason: { type: String },

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

    quotationResponse: { type: Object },
    quotationSuccess: { type: Boolean, default: false },

    orderRemark: { type: String, default: "" },

    sapStatus: { type: String, default: "Not Fetched" },
    sapStatusData: { type: Object, default: {} },

    totalBasePoints: { type: Number, default: null },
  },
  { timestamps: true }
);

const PurchaseOrderEntry = mongoose.model(
  "PurchaseOrderEntry",
  PurchasOrderEntrySchema
);

module.exports = PurchaseOrderEntry;