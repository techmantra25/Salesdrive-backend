const mongoose = require("mongoose");

const outletApprovedSchema = new mongoose.Schema(
  {
    zsm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    rsm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    asm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    cso: {
      type: String,
      default: null,
    },
    // createdBy: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   refPath: "createdBy_type",
    // },
    // createdBy_type: {
    //   type: String,
    //   enum: ["Employee", "User"],
    // },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true,
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
    },
    distributorId: {
      // not in use
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
    },
    outletCode: {
      type: String,
      required: true,
      unique: true,
    },
    outletUID: {
      type: String,
      required: true,
      unique: true,
    },
    outletName: {
      type: String,
      required: true,
    },
    sudoName: {
      type: String,
    },
    ownerName: {
      type: String,
      required: true,
    },
    createdBy: {
      type: String,
    },
    pin: {
      type: String,
    },
    district: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
    },
    mobile1: {
      type: String,
    },
    mobile2: {
      type: String,
    },
    whatsappNumber: {
      type: String,
    },
    teleCallingSlot: {
      type: [String],
      default: [
        "10:00 AM - 12:00 PM",
        "12:00 PM - 02:00 PM",
        "02:00 PM - 04:00 PM",
        "04:00 PM - 06:00 PM",
      ],
    },
    preferredLanguage: {
      type: String,
    },
    teleCallDay: {
      type: String,
    },
    beatId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Beat",
      required: true,
    },
    address1: {
      type: String,
    },
    address2: {
      type: String,
    },
    marketCenter: {
      type: String,
    },
    city: {
      type: String,
    },
    aadharNumber: {
      type: String,
    },
    panNumber: {
      type: String,
    },
    gstin: {
      type: String,
    },
    poiFrontImage: {
      type: String,
    },
    poiBackImage: {
      type: String,
    },
    outletImage: {
      type: String,
    },
    poaFrontImage: {
      type: String,
    },
    poaBackImage: {
      type: String,
    },
    gstImage: {
      type: String,
    },

    panImage: {
      type: String,
    },

    aadharImage: {
      type: String,
    },

    bankImage: {
      type: String,
    },
    enrollmentForm: {
      type: String,
    },
    location: {
      type: String,
    },
    gpsLocation: {
      type: String,
    },
    categoryOfOutlet: {
      type: [String],
      enum: ["Retail", "Wholesale", "Project", "Consumer", "Survey","RETAILER"],
      default: [],
    },
    // NEW: potential business value bracket for the outlet
    potentialSelection: {
      type: String,
      enum: [
        "Below 1 Lac",
        "Upto 3 Lac",
        "Upto 5 Lac",
        "Upto 10 Lac",
        "10 Lac & Above",
        "Survey",
      ],
      default: null,
    },
    // NEW: outlet owner's birthday
    birthday: {
      type: Date,
      default: null,
    },
    // NEW: payment behaviour category
    paymentCategory: {
      type: String,
      enum: ["Good", "Normal", "Follow Up", "RED", "Survey"],
      default: null,
    },
    sellingBrands: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Brand",
    },
    competitorBrands: {
      type: [String],
    },
    existingRetailer: {
      type: Boolean,
    },
    approvedDate: {
      type: Date,
    },
    enrolledByUser: {
      type: String,
    },
    outletSource: {
      type: String,
      enum: ["SFA", "Admin"],
      default: "Admin",
    },
    contactPerson: {
      type: String,
    },
    email: {
      type: String,
    },
    retailerClass: {
      type: String,
      enum: ["A", "B", "C", "D", "Survey"],
    },
    enrolledStatus: {
      type: String,
      enum: ["ENROLLED", "NOT ENROLLED"],
    },
    shipToAddress: {
      type: String,
    },
    shipToPincode: {
      type: String,
    },
    googleMapLink: {
      type: String,
    },
    // Additional fields for tracking
    createdFromLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Outlet",
    },
    outletType: {
      type: String,
      enum: ["transfer", "copy"],
    },
    referenceId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "OutletApproved",
    },
    transfertype: {
      type: String,
      enum: ["DB_TO_DB", "BEAT_To_BEAT"],
    },
    password: {
      type: String,
    },
    isPasswordReset: {
      type: Boolean,
      default: false,
    },
    sourceData: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApprovedSource",
    },
    currentPointBalance: {
      type: Number,
      default: 0,
      min: 0, // balance can't be negative
    },
    status: {
      type: Boolean,
      default: true,
    },
    massistRefIds: [
      {
        type: String,
      },
    ],
    isUpdatedOutletCode: {
      type: Boolean,
      default: false,
    },
    isFirstOpeningPoint: {
      type: Boolean,
      default: false,
    },
    deletedByApp: {
      type: Boolean,
      default: false,
    },
    mergedPoints: {
      type: Number,
      default: 0,
      min: 0, // balance can't be negative
    },
  },
  {
    timestamps: true,
  },
);

outletApprovedSchema.index({ beatId: 1, status: 1 });

outletApprovedSchema.index({
  outletName: "text",
  outletCode: "text",
  outletUID: "text",
});

const OutletApproved = mongoose.model("OutletApproved", outletApprovedSchema);

module.exports = OutletApproved;
