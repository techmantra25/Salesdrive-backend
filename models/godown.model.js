const mongoose = require("mongoose");

const godownSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
    },

    godownCode: {
      type: String,
      required: true,
      trim: true,
    },

    godownName: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: String,
      trim: true,
      default: "",
    },

    contactPerson: {
      type: String,
      trim: true,
      default: "",
    },

    contactPersonNumber: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    remarks: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Same godownCode can exist for different distributors,
// but cannot be duplicated under the same distributor.
godownSchema.index(
  {
    distributorId: 1,
    godownCode: 1,
  },
  {
    unique: true,
  }
);

const Godown = mongoose.model("Godown", godownSchema);

module.exports = Godown;