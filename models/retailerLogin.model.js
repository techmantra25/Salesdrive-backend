const mongoose = require("mongoose");

const retailerLoginSchema = new mongoose.Schema(
  {
    outletApprovedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OutletApproved",
      required: true,
    },
    token: {
      type: String,
    },
    otp:{
        type: String,
        required: false,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const RetailerLogin = mongoose.model("RetailerLogin", retailerLoginSchema);

module.exports = RetailerLogin;
