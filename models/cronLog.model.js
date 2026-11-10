// models/cronLog.model.js
const mongoose = require("mongoose");

const cronLogSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true, index: true },
    functionName: { type: String, required: true, index: true }, // cron function name
    schedule: { type: String },
    status: {
      type: String,
      enum: ["RUNNING", "SUCCESS", "FAILED", "SKIPPED", "INTERRUPTED"],
      required: true,
      index: true,
    },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
    durationMs: { type: Number },
    error: { type: String },
    host: { type: String }, // which server instance ran it
  },
  { timestamps: true, collection: "cron_logs" }
);

// latest runs per job
cronLogSchema.index({ jobName: 1, startedAt: -1 });

// auto-delete logs older than 30 days
cronLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("CronLog", cronLogSchema);