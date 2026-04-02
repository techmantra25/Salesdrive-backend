const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// Distributor Schema
const distributorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    dbCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    address1: String,
    address2: String,
    sbu: String,
    phone: String,
    gst_no: String,
    pan_no: String,
    email: {
      type: String,
      required: true,
      unique: true,
    },
    avatar: String,
    password: {
      type: String,
      required: true,
    },
    genPassword: String,
    role: {
      type: String,
      enum: ["GT"],
      default: "GT",
      required: true,
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
    },
    area: [String],
    status: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    goDown: {
      type: [String],
      default: ["main"],
    },
    access: {
      type: Array,
      default: [],
    },
    openingStock: {
      type: Boolean,
      default: false,
    },
    allowRLPEdit: {
      type: Boolean,
      default: false,
    },
    ownerName: String,
    district: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
    },
    dayOff: {
      type: [String],
      enum: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
      default: [],
    },
    city: String,
    RBPSchemeMapped: {
      type: String,
      enum: ["yes", "no"],
      default: "yes",
      required: true,
    },
    oldDate: {
      type: Date,
    },
    // NEW FIELDS FOR TRACKING RBPSchemeMapped UPDATES
    RBPSchemeMappedHistory: [
      {
        value: {
          type: String,
          enum: ["yes", "no"],
          required: true,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    primaryInvoiceType: {
      type: String,
      enum: ["All", "New"],
      default: "New",
    },
    RBPSchemeMappedLastUpdated: {
      type: Date,
    },
    pincode: String,
    brandId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Brand",
      },
    ],
    passwordResetToken: String,
    passwordResetExpires: Date,

    // ============ BILL DELIVERY PORTAL LOCK FIELDS ============
    // Portal lock status for undelivered bills
    isPortalLocked: {
      type: Boolean,
      default: false,
    },
    portalLockReason: {
      type: String,
      default: null,
    },
    portalLockedAt: {
      type: Date,
      default: null,
    },
    portalLockedBy: {
      type: String,
      enum: ["system", "admin"],
      default: null,
    },
    // Track pending bill deliveries that are causing the lock
    pendingBillDeliveries: [
      {
        billId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Bill",
        },
        billNo: String,
        createdAt: Date,
        deliveryDeadline: Date,
        invoiceAmount: Number,
      },
    ],
    lastPortalLockCheck: {
      type: Date,
      default: null,
    },
    // ============ END BILL DELIVERY PORTAL LOCK FIELDS ============
  },

  {
    timestamps: true,
  },
);

// Hash password and genPassword before saving
distributorSchema.pre("save", async function (next) {
  // Track RBPSchemeMapped changes
  if (this.isModified("RBPSchemeMapped")) {
    this.RBPSchemeMappedLastUpdated = new Date();

    // Add to history array
    this.RBPSchemeMappedHistory.push({
      value: this.RBPSchemeMapped,
      updatedAt: new Date(),
      updatedBy: this._updatedBy || this.createdBy || null, // Set from controller
    });
  }

  if (!this.isModified("password") && !this.isModified("genPassword")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);

    if (this.isModified("password")) {
      this.password = await bcrypt.hash(this.password, salt);
    }

    if (this.isModified("genPassword")) {
      this.genPassword = await bcrypt.hash(this.genPassword, salt);
    }

    next();
  } catch (err) {
    next(err);
  }
});

// Generate password reset token
distributorSchema.methods.createResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Uncomment if you want to use password comparison
// distributorSchema.methods.matchPassword = async function (enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

const Distributor = mongoose.model("Distributor", distributorSchema);

module.exports = Distributor;