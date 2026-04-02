/**
 * If backdate billing is enabled and today is 1st-2nd of a month, then creation of order will take last date of previous month,
 * returns the last date of the previous month at 5:30 AM (IST).
 *
 * @param {Boolean} enableBackdateBilling - Whether backdate billing is enabled
 * @param {Date} [now=new Date()] - The current date/time (for testability)
 * @returns {Object} - { billDate, isBackdated }
 */
function getOrderBackdate(
  orderDate,
  enableBackdateBilling,
  orderSource = null,
  now = new Date(),
) {
  if (!(orderDate instanceof Date) || isNaN(orderDate))
    return { billDate: now, isBackdated: false };
  if (!(now instanceof Date) || isNaN(now)) now = new Date();

  if (!enableBackdateBilling) {
    return { billDate: now, isBackdated: false };
  }

  // Only apply this backdate rule for orders created by Distributor
  // If orderSource is provided and is not 'Distributor', skip backdating
  if (orderSource && orderSource !== "Distributor") {
    return { billDate: now, isBackdated: false };
  }

  // If today is 1st-2nd of the month
  const todayDate = now.getDate();
  if (todayDate < 1 || todayDate > 2) {
    return { billDate: now, isBackdated: false };
  }

  // Order and now month/year
  const orderMonth = orderDate.getMonth();
  const orderYear = orderDate.getFullYear();
  const nowMonth = now.getMonth();
  const nowYear = now.getFullYear();

  const orderPlacedOnFirstTwoDaysOfCurrentMonth =
    orderYear === nowYear &&
    orderMonth === nowMonth &&
    orderDate.getDate() <= 2;

  const orderFromPreviousMonth =
    (nowYear === orderYear && nowMonth === orderMonth + 1) ||
    (nowMonth === 0 && orderMonth === 11 && nowYear === orderYear + 1);

  if (!orderFromPreviousMonth && !orderPlacedOnFirstTwoDaysOfCurrentMonth) {
    return { billDate: now, isBackdated: false };
  }

  const lastDayPrevMonth = new Date(nowYear, nowMonth, 0);
  lastDayPrevMonth.setHours(5, 30, 0, 0);
  return { billDate: lastDayPrevMonth, isBackdated: true };
}

module.exports = { getOrderBackdate };
