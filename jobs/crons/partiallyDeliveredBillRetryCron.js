const cron = require("cron");
const axios = require("axios");
const { API_URL } = require("../../config/server.config");
const SystemConfig = require("../../models/systemConfig.model");

const PARTIALLY_DELIVERED_BILL_RETRY_JOB = "partiallyDeliveredBillRetry";
const PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON = "30 01 * * *";
const CRON_TIMEZONE = "Asia/Kolkata";

let partiallyDeliveredBillRetryCron = null;

const isValidCronExpression = (cronTime) => {
  try {
    new cron.CronTime(cronTime, CRON_TIMEZONE);
    return true;
  } catch {
    return false;
  }
};

const stopPartiallyDeliveredBillRetryCron = () => {
  if (partiallyDeliveredBillRetryCron) {
    partiallyDeliveredBillRetryCron.stop();
    partiallyDeliveredBillRetryCron = null;
  }
};

const runPartiallyDeliveredBillRetryJob = async () => {
  try {
    console.log("Starting Partially-Delivered Bill Retry Cron...");

    const res = await axios.post(
      `${API_URL}/api/v2/bill/bulk-retry-partially-delivered-bills`,
    );

    if (res.status === 200) {
      console.log("Partially-Delivered Bills Retried Successfully");
      return;
    }

    console.log("Bulk retry returned non-200 status", res.status);
  } catch (error) {
    console.error(
      "Partially-Delivered Bill Retry Cron failed:",
      error.response?.data || error.message,
    );
  }
};

const ensurePartiallyDeliveredBillRetryConfig = async () => {
  const config = await SystemConfig.findOneAndUpdate(
    { job: PARTIALLY_DELIVERED_BILL_RETRY_JOB },
    {
      $setOnInsert: {
        job: PARTIALLY_DELIVERED_BILL_RETRY_JOB,
        cronTime: PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON,
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

const applyPartiallyDeliveredBillRetryCronConfig = async (config) => {
  const cronTime =
    config?.cronTime || PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON;
  const isActive = config?.isActive !== false;

  if (!isValidCronExpression(cronTime)) {
    throw new Error(`Invalid cron expression: ${cronTime}`);
  }

  stopPartiallyDeliveredBillRetryCron();

  partiallyDeliveredBillRetryCron = new cron.CronJob(
    cronTime,
    runPartiallyDeliveredBillRetryJob,
    null,
    false,
    CRON_TIMEZONE,
  );

  if (!isActive) {
    console.log(
      `Partially-Delivered Bill Retry Cron is disabled for schedule: ${cronTime} (${CRON_TIMEZONE})`,
    );
    return {
      started: false,
      cronTime,
      isActive,
      timezone: CRON_TIMEZONE,
    };
  }

  partiallyDeliveredBillRetryCron.start();
  console.log(
    `Partially-Delivered Bill Retry Cron started with schedule: ${cronTime} (${CRON_TIMEZONE})`,
  );

  return {
    started: true,
    cronTime,
    isActive,
    timezone: CRON_TIMEZONE,
  };
};

const startPartiallyDeliveredBillRetryCron = async () => {
  try {
    const config = await ensurePartiallyDeliveredBillRetryConfig();
    return await applyPartiallyDeliveredBillRetryCronConfig(config);
  } catch (error) {
    console.error(
      "Failed to initialize Partially-Delivered Bill Retry Cron:",
      error.message,
    );

    const fallbackConfig = {
      cronTime: PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON,
      isActive: true,
    };

    return applyPartiallyDeliveredBillRetryCronConfig(fallbackConfig);
  }
};

const getPartiallyDeliveredBillRetryCronMeta = () => {
  return {
    job: PARTIALLY_DELIVERED_BILL_RETRY_JOB,
    defaultCronTime: PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON,
    isRunning: Boolean(partiallyDeliveredBillRetryCron?.running),
    timezone: CRON_TIMEZONE,
  };
};

module.exports = {
  startPartiallyDeliveredBillRetryCron,
  applyPartiallyDeliveredBillRetryCronConfig,
  stopPartiallyDeliveredBillRetryCron,
  getPartiallyDeliveredBillRetryCronMeta,
  PARTIALLY_DELIVERED_BILL_RETRY_JOB,
  PARTIALLY_DELIVERED_BILL_RETRY_DEFAULT_CRON,
};
