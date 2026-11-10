// controllers/cronLog.controller.js
const asyncHandler = require("express-async-handler");
const CronLog = require("../../models/cronLog.model");

const TZ = "Asia/Kolkata";

// ---------- helpers ----------
const toIST = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: TZ, hour12: true }) : null;

const durationText = (ms) => {
  if (ms === undefined || ms === null) return null;
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

// shape each log document for the frontend
const formatLog = (log) => ({
  _id: log._id,
  jobName: log.jobName,
  functionName: log.functionName,
  schedule: log.schedule,
  status: log.status,
  startedAt: log.startedAt,
  endedAt: log.endedAt || null,
  startedAtIST: toIST(log.startedAt),
  endedAtIST: toIST(log.endedAt),
  durationMs: log.durationMs ?? null,
  durationText: durationText(log.durationMs),
  error: log.error || null,
  host: log.host,
});

// "YYYY-MM-DD" in IST -> Date range
const istDayStart = (s) => new Date(`${s}T00:00:00.000+05:30`);
const istDayEnd = (s) => new Date(`${s}T23:59:59.999+05:30`);

const STATUSES = ["RUNNING", "SUCCESS", "FAILED", "SKIPPED", "INTERRUPTED"];
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- GET /cron-logs ----------
// ?jobName=&functionName=&status=&fromDate=2026-11-01&toDate=2026-11-10&page=1&limit=20&sort=desc
const getCronLogs = asyncHandler(async (req, res) => {
  const {
    jobName,
    functionName,
    status,
    fromDate,
    toDate,
    page = 1,
    limit = 20,
    sort = "desc",
  } = req.query;

  const filter = {};
  if (jobName) filter.jobName = { $regex: escapeRegex(jobName.trim()), $options: "i" };
  if (functionName) filter.functionName = functionName;
  if (status) {
    const list = String(status)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => STATUSES.includes(s));
    if (list.length) filter.status = { $in: list };
  }
  if (fromDate || toDate) {
    filter.startedAt = {};
    if (fromDate) filter.startedAt.$gte = istDayStart(fromDate);
    if (toDate) filter.startedAt.$lte = istDayEnd(toDate);
  }

  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 20, 1), 200);

  const [logs, total] = await Promise.all([
    CronLog.find(filter)
      .sort({ startedAt: sort === "asc" ? 1 : -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
    CronLog.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 200,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l),
    data: logs.map(formatLog),
  });
});

// ---------- GET /cron-logs/:id ----------
const getCronLogById = asyncHandler(async (req, res) => {
  const log = await CronLog.findById(req.params.id).lean();
  if (!log) return res.status(404).json({ message: "Cron log not found" });
  res.status(200).json({ status: 200, data: formatLog(log) });
});

// ---------- GET /cron-logs-summary ----------
// per-job health: counts, last run, last success, last failure  (?days=7)
const getCronSummary = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await CronLog.aggregate([
    { $match: { startedAt: { $gte: since } } },
    { $sort: { startedAt: -1 } },
    {
      $group: {
        _id: "$jobName",
        functionName: { $first: "$functionName" },
        schedule: { $first: "$schedule" },
        total: { $sum: 1 },
        success: { $sum: { $cond: [{ $eq: ["$status", "SUCCESS"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
        skipped: { $sum: { $cond: [{ $eq: ["$status", "SKIPPED"] }, 1, 0] } },
        interrupted: { $sum: { $cond: [{ $eq: ["$status", "INTERRUPTED"] }, 1, 0] } },
        avgDurationMs: {
          $avg: { $cond: [{ $eq: ["$status", "SUCCESS"] }, "$durationMs", null] },
        },
        lastRun: { $first: "$$ROOT" },
        lastSuccess: {
          $first: { $cond: [{ $eq: ["$status", "SUCCESS"] }, "$$ROOT", null] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // lastSuccess / lastFailure need their own lookup (group $first can't skip nulls)
  const data = await Promise.all(
    rows.map(async (r) => {
      const [lastSuccess, lastFailure] = await Promise.all([
        CronLog.findOne({ jobName: r._id, status: "SUCCESS" }).sort({ startedAt: -1 }).lean(),
        CronLog.findOne({ jobName: r._id, status: { $in: ["FAILED", "INTERRUPTED"] } })
          .sort({ startedAt: -1 })
          .lean(),
      ]);

      return {
        jobName: r._id,
        functionName: r.functionName,
        schedule: r.schedule,
        totalRuns: r.total,
        success: r.success,
        failed: r.failed,
        skipped: r.skipped,
        interrupted: r.interrupted,
        avgDurationMs: r.avgDurationMs ? Math.round(r.avgDurationMs) : null,
        avgDurationText: durationText(r.avgDurationMs ? Math.round(r.avgDurationMs) : null),
        lastRun: formatLog(r.lastRun),
        lastSuccess: lastSuccess ? formatLog(lastSuccess) : null,
        lastFailure: lastFailure ? formatLog(lastFailure) : null,
      };
    })
  );

  res.status(200).json({ status: 200, days, data });
});

module.exports = { getCronLogs, getCronLogById, getCronSummary };