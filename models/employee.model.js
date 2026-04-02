const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const empDisHistorySchema = new mongoose.Schema({
  distributorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Distributor",
  },
  mappedDate: {
    type: Date,
  },
  unMappedDate: {
    type: Date,
  },
  currentStatus: {
    type: Boolean,
    default: true,
  },
});

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    empId: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
    },
    passwordResetToken: String,
    passwordResetExpires: Date,
    desgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      required: true,
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
    },
    regionId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Region",
    },
    brandId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Brand",
    },
    area: {
      type: [String],
    },
    empMappingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployeeMapping",
      default: null,
    },
    leaving_date: {
      type: Date,
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
    distributorMappingHistory: [empDisHistorySchema],
    distributorId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Distributor",
    },
    beatId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Beat",
    },

    // new fields for rupa
    employeeLabel: {
      type: String,
    },
    phone: {
      type: String,
    },
    dob: {
      type: Date,
    },
    joiningDate: {
      type: Date,
    },
    headquarter: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      lowercase: true,
    },
    tenure: {
      type: Number,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
    },
  },
  {
    timestamps: true,
  }
);

// Method to hash password before saving
employeeSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Method to create password reset token
employeeSchema.methods.createResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

const Employee = mongoose.model("Employee", employeeSchema);

module.exports = Employee;
