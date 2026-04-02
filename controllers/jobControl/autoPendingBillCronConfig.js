const asyncHandler = require("express-async-handler");
const cron = require("cron");
const SystemConfig = require("../../models/systemConfig.model");
const {
  applyAutoPendingBillCronConfig,
  AUTO_PENDING_BILL_JOB,
  AUTO_PENDING_BILL_DEFAULT_CRON,
} = require("../../jobs/crons/autoPendingBillDeliveryCron");

const validateCronExpression = (cronTime) => {
  try {
    new cron.CronTime(cronTime);
    return true;
  } catch {
    return false;
  }
};

const getAutoPendingBillCronConfig = asyncHandler(async (req, res) => {
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

  return res.status(200).json({
    status: 200,
    error: false,
    message: "Auto pending bill cron config fetched successfully",
    data: config,
  });
});

const updateAutoPendingBillCronConfig = asyncHandler(async (req, res) => {
  const { cronTime, isActive } = req.body;
  const updateData = {};

  if (cronTime !== undefined) {
    if (typeof cronTime !== "string" || !cronTime.trim()) {
      return res.status(400).json({
        status: 400,
        error: true,
        message: "cronTime must be a non-empty string",
      });
    }

    const normalizedCronTime = cronTime.trim();

    if (!validateCronExpression(normalizedCronTime)) {
      return res.status(400).json({
        status: 400,
        error: true,
        message: "Invalid cron expression",
      });
    }

    updateData.cronTime = normalizedCronTime;
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        status: 400,
        error: true,
        message: "isActive must be a boolean",
      });
    }

    updateData.isActive = isActive;
  }

  if (!Object.keys(updateData).length) {
    return res.status(400).json({
      status: 400,
      error: true,
      message: "Provide at least one field: cronTime or isActive",
    });
  }

  const updateQuery = {
    $set: updateData,
    $setOnInsert: {
      job: AUTO_PENDING_BILL_JOB,
    },
  };

  if (cronTime === undefined) {
    updateQuery.$setOnInsert.cronTime = AUTO_PENDING_BILL_DEFAULT_CRON;
  }

  const config = await SystemConfig.findOneAndUpdate(
    { job: AUTO_PENDING_BILL_JOB },
    updateQuery,
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  await applyAutoPendingBillCronConfig(config);

  return res.status(200).json({
    status: 200,
    error: false,
    message: "Auto pending bill cron config updated successfully",
    data: config,
  });
});

module.exports = {
  getAutoPendingBillCronConfig,
  updateAutoPendingBillCronConfig,
};
