const mongoose = require("mongoose");

const outletApprovedSourceSchema = new mongoose.Schema(
  {
    sourceData:[
        {
          type:Object,
          default:{}
        }
    ]
  },
  {
    timestamps: true,
  }
);

const OutletApprovedSource = mongoose.model("OutletApprovedSource", outletApprovedSourceSchema);

module.exports = OutletApprovedSource;
