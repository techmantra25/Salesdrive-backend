// utils/cronLogger.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const cron = require("cron");
const CronLog = require("../models/cronLog.model");

const TZ = "Asia/Kolkata";
const LOG_DIR = path.join(__dirname, "../logs");
const HOST = `${os.hostname()}:${process.pid}`;

try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  console.error("Could not create cron log dir:", e.message);
}

// ---------- time helpers (always IST) ----------
const istDate = (d = new Date()) =>
  d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD

const istDateTime = (d = new Date()) =>
  d.toLocaleString("en-IN", { timeZone: TZ, hour12: true });

// ---------- file + console logger (one file per day) ----------
const writeLog = (message) => {
  const line = `[${istDateTime()}] ${message}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(path.join(LOG_DIR, `cron-${istDate()}.log`), line);
  } catch (e) {
    console.error("Cron log file write failed:", e.message);
  }
};

// ---------- in-memory status of every job ----------
const cronStatus = {};

// ---------- safe DB helpers (a DB error must never stop a cron job) ----------
const dbCreate = async (doc) => {
  try {
    return await CronLog.create(doc);
  } catch (e) {
    console.error("CronLog create failed:", e.message);
    return null;
  }
};

const dbUpdate = async (id, update) => {
  if (!id) return;
  try {
    await CronLog.findByIdAndUpdate(id, update);
  } catch (e) {
    console.error("CronLog update failed:", e.message);
  }
};

// On startup, mark runs that were left RUNNING (server crashed/restarted mid-run)
const markInterruptedRuns = async () => {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // older than 30 min
    const r = await CronLog.updateMany(
      { status: "RUNNING", startedAt: { $lt: cutoff } },
      {
        status: "INTERRUPTED",
        endedAt: new Date(),
        error: "Server restarted or crashed while job was running",
      }
    );
    if (r.modifiedCount) {
      writeLog(`⚠️  Marked ${r.modifiedCount} stale RUNNING cron log(s) as INTERRUPTED`);
    }
  } catch (e) {
    console.error("markInterruptedRuns failed:", e.message);
  }
};
markInterruptedRuns();

// ---------- wrapper: logs start / success / failure + overlap guard ----------
const runCronJob = async (name, handler) => {
  const status = cronStatus[name];

  if (status.running) {
    status.skippedCount += 1;
    writeLog(`⏭️  ${name} SKIPPED (previous run still in progress)`);
    await dbCreate({
      jobName: name,
      functionName: status.functionName,
      schedule: status.schedule,
      status: "SKIPPED",
      startedAt: new Date(),
      endedAt: new Date(),
      durationMs: 0,
      host: HOST,
    });
    return;
  }

  const startedAt = new Date();
  status.running = true;
  status.lastStart = istDateTime(startedAt);
  status.runCount += 1;
  writeLog(`▶️  ${name} (${status.functionName}) STARTED`);

  const logDoc = await dbCreate({
    jobName: name,
    functionName: status.functionName,
    schedule: status.schedule,
    status: "RUNNING",
    startedAt,
    host: HOST,
  });

  try {
    await handler();
    const ms = Date.now() - startedAt.getTime();

    status.lastStatus = "SUCCESS";
    status.lastError = null;
    status.lastDurationMs = ms;
    status.lastSuccess = istDateTime();

    writeLog(`✅ ${name} (${status.functionName}) SUCCESS in ${ms}ms`);

    await dbUpdate(logDoc?._id, {
      status: "SUCCESS",
      endedAt: new Date(),
      durationMs: ms,
    });
  } catch (error) {
    const ms = Date.now() - startedAt.getTime();
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;

    status.lastStatus = "FAILED";
    status.lastError = msg;
    status.lastDurationMs = ms;
    status.failCount += 1;

    writeLog(`🔥 ${name} (${status.functionName}) FAILED in ${ms}ms | ${msg}`);

    await dbUpdate(logDoc?._id, {
      status: "FAILED",
      endedAt: new Date(),
      durationMs: ms,
      error: msg,
    });
  } finally {
    status.running = false;
    status.lastEnd = istDateTime();
    try {
      status.nextRun = String(status.job.nextDate());
    } catch (_) {}
  }
};

// ---------- register a job ----------
const registerCronJob = ({ name, functionName, schedule, handler }) => {
  cronStatus[name] = {
    functionName: functionName || name,
    schedule,
    running: false,
    runCount: 0,
    failCount: 0,
    skippedCount: 0,
    lastStart: null,
    lastEnd: null,
    lastSuccess: null,
    lastStatus: "NEVER_RAN",
    lastError: null,
    lastDurationMs: null,
    nextRun: null,
    job: null,
  };

  const job = new cron.CronJob(
    schedule,
    () => runCronJob(name, handler),
    null,
    true,
    TZ
  );

  cronStatus[name].job = job;
  try {
    cronStatus[name].nextRun = String(job.nextDate());
  } catch (_) {}

  writeLog(
    `🕒 Cron registered: ${name} (${cronStatus[name].functionName}) | schedule "${schedule}" | next run: ${cronStatus[name].nextRun}`
  );

  return job;
};

// status without the job object (safe to send as JSON)
const getCronStatusJSON = () =>
  Object.fromEntries(
    Object.entries(cronStatus).map(([k, { job, ...rest }]) => [k, rest])
  );

module.exports = {
  writeLog,
  registerCronJob,
  runCronJob,
  getCronStatusJSON,
};