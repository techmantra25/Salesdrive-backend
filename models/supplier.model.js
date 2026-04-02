const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    supplierCode: {
      type: String,
      required: true,
      unique: true,
    },
    coCode: {
      //new fields
      type: String,
      required: true,
    },
    distributorId: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Distributor",
      required: false,
      default: [],
    },
    supplierName: {
      type: String,
      required: true,
    },
    address: {
      type: String,
    },
    city: {
      type: String,
    },
    supplierType: {
      type: String,
      enum: ["C&Agent", "Factory", "Depo", "Company", "Distributor"],
      required: true,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
    },
    gstNo: {
      type: String,
    },
    contactNo: {
      type: String,
      //required: true,
    },
    email: {
      type: String,
      // required: true,
    },
    pinCode: {
      type: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

const Supplier = mongoose.model("Supplier", supplierSchema);

module.exports = Supplier;
