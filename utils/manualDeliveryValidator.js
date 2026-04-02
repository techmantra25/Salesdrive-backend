const moment = require("moment-timezone");
const BillDeliverySetting = require("../models/billDeliverySetting.model");

/**
 * Validates if manual delivery is allowed for a distributor
 *
 * Rules:
 * 1. If enableBackdateBilling is YES (true):
 *    - Apply backdate billing logic
 *    - Manual delivery is allowed only during 1st-3rd of current month (grace period)
 *    - Auto-deliver cron will deliver only previous month bills
 *    - If bill on Feb and delivered on Mar 1-4, delivery date takes last day of month
 *    - Bills generated on 1-3 of Mar will not be included in 4th Mar cron
 * 2. If enableBackdateBilling is NO (false):
 *    - Do not apply backdate billing logic
 *    - Bills not auto-delivered by cron
 *    - Takes real-time delivery date (not last date of month)
 *    - Manual delivery allowed anytime
 *
 * @param {String} distributorId - The distributor ID
 * @param {String} billId - The bill ID (optional, for bill-specific checks)
 * @returns {Object} { allowed: boolean, reason: string, setting: object }
 */
const validateManualDelivery = async (distributorId, billId = null) => {
  try {
    // Get the delivery setting for this distributor (regardless of isActive status)
    // We need to check enableBackdateBilling even if isActive is false
    const setting = await BillDeliverySetting.findOne({
      distributorId,
    });

    // If no setting exists at all, allow manual delivery (backward compatibility)
    if (!setting) {
      return {
        allowed: true,
        reason: "No delivery configuration found - manual delivery allowed",
        setting: null,
      };
    }

    // Check if backdate billing is enabled (independent of isActive)
    const enableBackdateBilling = setting.enableBackdateBilling === true;

    if (!enableBackdateBilling) {
      // Backdate billing is NO - manual delivery is allowed anytime with real-time date
      return {
        allowed: true,
        reason: `Manual delivery allowed anytime (backdate billing disabled)`,
        setting,
        isGracePeriod: false,
      };
    } else {
      // Backdate billing is YES - manual is still allowed.
      // Bill-level month-window is applied during backdate calculation:
      // previous-month bill => backdate, otherwise => real-time.
      return {
        allowed: true,
        reason:
          "Manual delivery allowed. Backdate applies only for previous-month bills; current/older bills use real-time delivery date.",
        setting,
        isGracePeriod: false,
      };
    }
  } catch (error) {
    console.error("Error validating manual delivery:", error);
    // In case of error, allow manual delivery (fail-safe approach)
    return {
      allowed: true,
      reason:
        "Error checking delivery settings - manual delivery allowed by default",
      error: error.message,
    };
  }
};

/**
 * Checks if a bill is from the previous month
 * @param {Date} billCreatedDate - The bill creation date
 * @returns {Boolean}
 */
const isBillFromPreviousMonth = (billCreatedDate) => {
  const now = moment().tz("Asia/Kolkata");
  const billDate = moment(billCreatedDate).tz("Asia/Kolkata");

  // Get previous month
  const previousMonth = now.clone().subtract(1, "month");

  // Check if bill is from the previous month (any day)
  return (
    billDate.month() === previousMonth.month() &&
    billDate.year() === previousMonth.year()
  );
};

/**
 * Checks if a bill is from the last day of previous month
 * @param {Date} billCreatedDate - The bill creation date
 * @returns {Boolean}
 */
const isBillFromLastDayOfPreviousMonth = (billCreatedDate) => {
  const now = moment().tz("Asia/Kolkata");
  const billDate = moment(billCreatedDate).tz("Asia/Kolkata");

  // Get last day of previous month
  const lastDayOfPrevMonth = moment()
    .tz("Asia/Kolkata")
    .subtract(1, "month")
    .endOf("month");

  // Check if bill is from the last day of previous month
  return (
    billDate.date() === lastDayOfPrevMonth.date() &&
    billDate.month() === lastDayOfPrevMonth.month() &&
    billDate.year() === lastDayOfPrevMonth.year()
  );
};

/**
 * Enhanced validation for bill-specific manual delivery
 * @param {String} distributorId
 * @param {Object} bill - The bill object with createdAt date
 * @returns {Object}
 */
const validateBillManualDelivery = async (distributorId, bill) => {
  const validation = await validateManualDelivery(distributorId, bill._id);

  // If auto-delivery is ON, manual delivery is not allowed
  if (!validation.allowed) {
    return validation;
  }

  // If manual delivery itself is blocked, return early
  if (!bill || !bill.createdAt) {
    return {
      ...validation,
      allowed: false,
      reason: "Invalid bill payload for manual delivery validation",
    };
  }

  // Bill-level month-window outcome for backdate logic
  const now = moment().tz("Asia/Kolkata");
  const billMonth = moment(bill.createdAt).tz("Asia/Kolkata").month();
  const currentMonth = now.month();

  if (isBillFromPreviousMonth(bill.createdAt)) {
    return {
      ...validation,
      allowed: true,
      reason:
        "Manual delivery allowed. Previous-month bill is eligible for backdate logic.",
      billMonth: "previous",
      applyBackdate: validation.setting?.enableBackdateBilling === true,
    };
  }

  if (billMonth === currentMonth) {
    return {
      ...validation,
      allowed: true,
      reason:
        "Manual delivery allowed. Current-month bill uses real-time delivery date.",
      billMonth: "current",
      applyBackdate: false,
    };
  }

  return {
    ...validation,
    allowed: true,
    reason:
      "Manual delivery allowed. Older-than-previous-month bill uses real-time delivery date.",
    billMonth: "older",
    applyBackdate: false,
  };
};

module.exports = {
  validateManualDelivery,
  validateBillManualDelivery,
  isBillFromPreviousMonth,
  isBillFromLastDayOfPreviousMonth,
};
