const BillLog = require("../../../models/billLog.model");

const createBillLog = async ({
  billId,
  lineItemId = null,
  event,
  triggeredBy,
  beforeQty = null,
  afterQty = null,
  userId = null,
  meta = {},
}) => {
  try {
    await BillLog.create({
      billId,
      lineItemId,
      event,
      triggeredBy,
      beforeQty,
      afterQty,
      userId,
      meta,
    });
  } catch (err) {
    // Never let logging break the main flow
    console.error(`[BillLog] Failed to write log: ${err.message}`);
  }
};

module.exports = createBillLog;