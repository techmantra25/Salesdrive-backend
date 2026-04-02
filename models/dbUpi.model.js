const mongoose = require("mongoose");

const dbUpiSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    dbCode: {
      type: String,
      required: true,
      trim: true,
    },
    dbName: {
      type: String,
      required: true,
    },
    mobileNo: {
      type: String,
      required: true,
      trim: true,
    },
    upiId: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v) {
          // Validate UPI ID format: username@bankname
          return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(v);
        },
        message: (props) => `${props.value} is not a valid UPI ID!`,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

dbUpiSchema.index({ distributorId: 1 }, { unique: true });

const DBUpi = mongoose.model("DBUpi", dbUpiSchema);

module.exports = DBUpi;
