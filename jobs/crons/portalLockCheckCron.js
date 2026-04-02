const cron = require("cron");
const SystemConfig = require("../../models/systemConfig.model");
const { checkAndLockDistributorPortals } = require("../checkPortalLock");

const PORTAL_LOCK_CHECK_JOB = "portalLockCheck";
const PORTAL_LOCK_CHECK_DEFAULT_CRON = "0 23 * * *";
const CRON_TIMEZONE = "Asia/Kolkata";

let portalLockCheckCron = null;

const isValidCronExpression = (cronTime) => {
  try {
    new cron.CronTime(cronTime, CRON_TIMEZONE);
    return true;
  } catch {
    return false;
  }
};

const stopPortalLockCheckCron = () => {
  if (portalLockCheckCron) {
    portalLockCheckCron.stop();
    portalLockCheckCron = null;
  }
};

const runPortalLockCheckJob = async () => {
  try {
    console.log("Starting Portal Lock Check Cron...");
    await checkAndLockDistributorPortals();
    console.log("Completed Portal Lock Check Cron");
  } catch (error) {
    console.error("Portal Lock Check Cron failed:", error.message);
  }
};

const ensurePortalLockCheckConfig = async () => {
  const config = await SystemConfig.findOneAndUpdate(
    { job: PORTAL_LOCK_CHECK_JOB },
    {
      $setOnInsert: {
        job: PORTAL_LOCK_CHECK_JOB,
        cronTime: PORTAL_LOCK_CHECK_DEFAULT_CRON,
        isActive: true,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return config;
};

const applyPortalLockCheckCronConfig = async (config) => {
  const cronTime = config?.cronTime || PORTAL_LOCK_CHECK_DEFAULT_CRON;
  const isActive = config?.isActive !== false;

  if (!isValidCronExpression(cronTime)) {
    throw new Error(`Invalid cron expression: ${cronTime}`);
  }

  stopPortalLockCheckCron();

  portalLockCheckCron = new cron.CronJob(
    cronTime,
    runPortalLockCheckJob,
    null,
    false,
    CRON_TIMEZONE,
  );

  if (!isActive) {
    console.log(
      `Portal Lock Check Cron is disabled for schedule: ${cronTime} (${CRON_TIMEZONE})`,
    );
    return {
      started: false,
      cronTime,
      isActive,
      timezone: CRON_TIMEZONE,
    };
  }

  portalLockCheckCron.start();
  console.log(
    `Portal Lock Check Cron started with schedule: ${cronTime} (${CRON_TIMEZONE})`,
  );

  return {
    started: true,
    cronTime,
    isActive,
    timezone: CRON_TIMEZONE,
  };
};

const startPortalLockCheckCron = async () => {
  try {
    const config = await ensurePortalLockCheckConfig();
    return await applyPortalLockCheckCronConfig(config);
  } catch (error) {
    console.error(
      "Failed to initialize Portal Lock Check Cron:",
      error.message,
    );

    const fallbackConfig = {
      cronTime: PORTAL_LOCK_CHECK_DEFAULT_CRON,
      isActive: true,
    };

    return applyPortalLockCheckCronConfig(fallbackConfig);
  }
};

const getPortalLockCheckCronMeta = () => {
  return {
    job: PORTAL_LOCK_CHECK_JOB,
    defaultCronTime: PORTAL_LOCK_CHECK_DEFAULT_CRON,
    isRunning: Boolean(portalLockCheckCron?.running),
    timezone: CRON_TIMEZONE,
  };
};

module.exports = {
  startPortalLockCheckCron,
  applyPortalLockCheckCronConfig,
  stopPortalLockCheckCron,
  getPortalLockCheckCronMeta,
  PORTAL_LOCK_CHECK_JOB,
  PORTAL_LOCK_CHECK_DEFAULT_CRON,
};
