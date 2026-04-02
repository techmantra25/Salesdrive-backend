const cron = require("cron");
const axios = require("axios");
const { API_URL } = require("../../config/server.config");
const { SERVER_URL } = require("../../config/server.config");
const SystemConfig = require("../../models/systemConfig.model");
const CronDataCache = require("../../utils/cronDataCache");
const { checkAndLockDistributorPortals } = require("../checkPortalLock");

const AUTO_PENDING_BILL_JOB = "autoPendingBillDelivery";
const AUTO_PENDING_BILL_DEFAULT_CRON = "5 0 1-4 * *";
const CRON_TIMEZONE = "Asia/Kolkata";

let autoPendingBillDeliveryCron = null;

// Initialize data cache for this cron job (24-hour cache)
let dataCache = new CronDataCache(
  AUTO_PENDING_BILL_JOB,
  `${API_URL}/api/v2/bill/auto-deliver-pending-bills`,
);

const isValidCronExpression = (cronTime) => {
  try {
    new cron.CronTime(cronTime, CRON_TIMEZONE);
    return true;
  } catch {
    return false;
  }
};

const stopAutoPendingBillCron = () => {
  if (autoPendingBillDeliveryCron) {
    autoPendingBillDeliveryCron.stop();
    autoPendingBillDeliveryCron = null;
  }
};

const runAutoPendingBillDeliveryJob = async () => {
  try {
    console.log("Starting Auto Pending Bill Delivery Cron...");

    // Get data using 24-hour cache mechanism
    const data = await dataCache.getOrFetchData();

    if (data) {
      console.log(
        "Completed Auto Pending Bill Delivery Cron",
        data?.metadata || "",
      );

      // Re-evaluate portal locks immediately after auto delivery processing.
      await checkAndLockDistributorPortals();

      return;
    }

    console.log("Auto Pending Bill Delivery Cron returned no data");

    // Even when no payload is returned, still reconcile lock status.
    await checkAndLockDistributorPortals();
  } catch (error) {
    console.error("Auto Pending Bill Delivery Cron failed:", error.message);
  }
};

const ensureAutoPendingBillConfig = async () => {
  const config = await SystemConfig.findOneAndUpdate(
    { job: AUTO_PENDING_BILL_JOB },
    {
      $setOnInsert: {
        job: AUTO_PENDING_BILL_JOB,
        cronTime: AUTO_PENDING_BILL_DEFAULT_CRON,
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

const applyAutoPendingBillCronConfig = async (config) => {
  const cronTime = config?.cronTime || AUTO_PENDING_BILL_DEFAULT_CRON;
  const isActive = config?.isActive !== false;

  if (!isValidCronExpression(cronTime)) {
    throw new Error(`Invalid cron expression: ${cronTime}`);
  }

  stopAutoPendingBillCron();

  autoPendingBillDeliveryCron = new cron.CronJob(
    cronTime,
    runAutoPendingBillDeliveryJob,
    null,
    false,
    CRON_TIMEZONE,
  );

  if (!isActive) {
    console.log(
      `Auto Pending Bill Delivery Cron is disabled for schedule: ${cronTime} (${CRON_TIMEZONE})`,
    );
    return {
      started: false,
      cronTime,
      isActive,
      timezone: CRON_TIMEZONE,
    };
  }

  autoPendingBillDeliveryCron.start();
  console.log(
    `Auto Pending Bill Delivery Cron started with schedule: ${cronTime} (${CRON_TIMEZONE})`,
  );

  return {
    started: true,
    cronTime,
    isActive,
    timezone: CRON_TIMEZONE,
  };
};

const startAutoPendingBillCron = async () => {
  try {
    const config = await ensureAutoPendingBillConfig();
    return await applyAutoPendingBillCronConfig(config);
  } catch (error) {
    console.error(
      "Failed to initialize Auto Pending Bill Delivery Cron:",
      error.message,
    );

    const fallbackConfig = {
      cronTime: AUTO_PENDING_BILL_DEFAULT_CRON,
      isActive: true,
    };

    return applyAutoPendingBillCronConfig(fallbackConfig);
  }
};

const getAutoPendingBillCronMeta = () => {
  return {
    job: AUTO_PENDING_BILL_JOB,
    defaultCronTime: AUTO_PENDING_BILL_DEFAULT_CRON,
    isRunning: Boolean(autoPendingBillDeliveryCron?.running),
    timezone: CRON_TIMEZONE,
    cache: dataCache.getCacheMetadata(),
  };
};

const clearDataCache = () => {
  dataCache.clearCache();
};

const forceRefreshCache = async () => {
  return await dataCache.forceRefresh();
};

module.exports = {
  startAutoPendingBillCron,
  applyAutoPendingBillCronConfig,
  stopAutoPendingBillCron,
  getAutoPendingBillCronMeta,
  clearDataCache,
  forceRefreshCache,
  AUTO_PENDING_BILL_JOB,
  AUTO_PENDING_BILL_DEFAULT_CRON,
};
