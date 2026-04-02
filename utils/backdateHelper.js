const moment = require("moment-timezone");

/**
 * Calculate backdate fields for cross-month bill delivery
 *
 * If a bill is billed in one month and delivered in the next month,
 * AND enableBackdateBilling is YES, we set a backdate to the last day of the
 * billing month for multiplier calculations.
 *
 * The multiplier uses dates.deliveryDate, so we set that to the last date when applicable.
 * originalDeliveryDate stores the actual delivery date for display to distributor.
 *
 * Backdate applies only in previous-month delivery window:
 * bill month != delivery month and delivery happens in the immediate next month.
 *
 * @param {Date} billCreatedDate - The date when the bill was created
 * @param {Date} actualDeliveryDate - The actual delivery date (defaults to now)
 * @param {Boolean} enableBackdateBilling - Whether backdate billing is enabled (defaults to false)
 * @param {Date} autoPendingBillCronSetAt - Deprecated, retained for backward compatibility
 * @returns {Object} - Object containing deliveryDate, originalDeliveryDate, and enabledBackDate
 */
const calculateBackdateFields = (
  billCreatedDate,
  actualDeliveryDate = new Date(),
  enableBackdateBilling = false,
  autoPendingBillCronSetAt = null,
) => {
  const createdMoment = moment.tz(billCreatedDate, "Asia/Kolkata");
  const deliveryMoment = moment.tz(actualDeliveryDate, "Asia/Kolkata");

  // Check if bill was created in a different month than delivery
  const isDifferentMonth =
    createdMoment.format("YYYY-MM") !== deliveryMoment.format("YYYY-MM");

  // Check if delivery month is the next month after billing month
  // Use moment add(1, 'month') to compare properly - delivery should be in the next calendar month
  const nextMonthStart = createdMoment.clone().add(1, "month").startOf("month");
  const nextMonthEnd = createdMoment.clone().add(1, "month").endOf("month");
  const isNextMonth =
    deliveryMoment.isSameOrAfter(nextMonthStart) &&
    deliveryMoment.isSameOrBefore(nextMonthEnd);

  // Backdate logic: Apply if:
  // 1. enableBackdateBilling is YES (true)
  // 2. Bill billed in one month and delivered in next month (previous month window)
  const shouldApplyBackdate =
    enableBackdateBilling === true && isDifferentMonth && isNextMonth;

  if (shouldApplyBackdate) {
    // Get the last date of billing month with fixed backdate time (05:30 AM IST)
    const lastDateOfBillingMonthAt530AM = createdMoment
      .clone()
      .endOf("month")
      .hour(5)
      .minute(30)
      .second(0)
      .millisecond(0)
      .toDate();

    return {
      deliveryDate: lastDateOfBillingMonthAt530AM, // Set to last date 05:30 AM for multiplier
      originalDeliveryDate: actualDeliveryDate, // Real delivery date for display to distributor
      enabledBackDate: true, // Flag indicating backdate is applied
    };
  } else {
    // No backdate needed - either backdating disabled OR delivery in same month or not within eligible window
    return {
      deliveryDate: actualDeliveryDate, // Use actual date for multiplier
      originalDeliveryDate: actualDeliveryDate, // Real delivery date
      enabledBackDate: false, // No backdate applied
    };
  }
};

module.exports = {
  calculateBackdateFields,
};
