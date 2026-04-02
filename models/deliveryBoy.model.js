const mongoose = require("mongoose");

const deliveryBoySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },
    deliveryBoyCode: {
      type: String,
      required: true,
      unique: true,
    },
    mobileNo: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    status: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const DeliveryBoy = mongoose.model("DeliveryBoy", deliveryBoySchema);

module.exports = DeliveryBoy;
