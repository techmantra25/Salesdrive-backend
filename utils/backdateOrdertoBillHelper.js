/**
 * Determines the bill date for an order based on order date and current date.
 * If backdate billing is enabled and today is 1st-4th of a month, and the order is from the previous month,
 * returns the last date of the previous month at 5:30 AM (IST). Otherwise, returns the actual date.
 *
 * @param {Date} orderDate - The date of the order (from OrderEntry.createdAt)
 * @param {Boolean} enableBackdateBilling - Whether backdate billing is enabled
 * @param {Date} [now=new Date()] - The current date/time (for testability)
 * @returns {Object} - { billDate, isBackdated }
 */
function getOrderToBillBackdate(
  orderDate,
  enableBackdateBilling,
  now = new Date(),
) {
  if (!(orderDate instanceof Date) || isNaN(orderDate))
    return { billDate: now, isBackdated: false };
  if (!(now instanceof Date) || isNaN(now)) now = new Date();

  if (!enableBackdateBilling) {
    return { billDate: now, isBackdated: false };
  }

  // If today is 1st-2nd of the month
  const todayDate = now.getDate();
  if (todayDate < 1 || todayDate > 2) {
    return { billDate: now, isBackdated: false };
  }

  // If order is from previous month
  const orderMonth = orderDate.getMonth();
  const orderYear = orderDate.getFullYear();
  const nowMonth = now.getMonth();
  const nowYear = now.getFullYear();

  // If order is not from previous month, do not backdate
  if (
    !(nowYear === orderYear && nowMonth === orderMonth + 1) &&
    !(nowMonth === 0 && orderMonth === 11 && nowYear === orderYear + 1)
  ) {
    return { billDate: now, isBackdated: false };
  }

  // Set bill date to last day of previous month at 5:30 AM IST
  const lastDayPrevMonth = new Date(nowYear, nowMonth, 0); // 0th day of current month = last day of previous month
  lastDayPrevMonth.setHours(5, 30, 0, 0);
  return { billDate: lastDayPrevMonth, isBackdated: true };
}

module.exports = { getOrderToBillBackdate };
