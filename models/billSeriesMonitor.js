const mongoose = require("mongoose");

const billSeriesMonitorSchema = new mongoose.Schema({
  distributorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Distributor",
    required: true,
  },

  issueType: {
    type: String,
    enum: ["duplicate", "gapping", 'duplicate_and_gapping'],
    default: null,
  },
  issueMessage: {
    type: String,
    default: "",
  },
  monitoredAt: {
    type: Date,
    default: Date.now,
  },
  hasIssues: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model("BillSeriesMonitor", billSeriesMonitorSchema);
