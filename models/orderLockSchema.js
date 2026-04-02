const mongoose = require("mongoose");

const orderLockSchema = new mongoose.Schema(
  {
    name: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 60 },
    processId: { type: String },
    lockType: { type: String, default: "order" },
  },
  { timestamps: true }
);

const OrderLock = mongoose.model("OrderLock", orderLockSchema);

async function acquireOrderLock(lockName, maxWaitTime = 30000) {
  const processId = `${process.pid}-${Date.now()}-${Math.random()}`;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const result = await OrderLock.findOneAndUpdate(
        {
          name: lockName,
          $or: [
            { createdAt: { $lt: new Date(Date.now() - 60000) } },
            { name: { $exists: false } },
          ],
        },
        {
          $set: {
            name: lockName,
            createdAt: new Date(),
            processId: processId,
            lockType: "order",
          },
        },
        { upsert: true, new: true }
      );

      if (result && result.processId === processId) {
        return true;
      }

      if (result && result.processId !== processId) {
        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 200)
        );
        continue;
      }
    } catch (error) {
      if (error.code === 11000) {
        try {
          const existingLock = await OrderLock.findOne({ name: lockName });
          if (
            existingLock &&
            Date.now() - existingLock.createdAt.getTime() > 60000
          ) {
            await OrderLock.deleteOne({
              name: lockName,
              createdAt: { $lt: new Date(Date.now() - 60000) },
            });
          }
        } catch (cleanupError) {
          console.error("Order lock cleanup error:", cleanupError);
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 200)
        );
        continue;
      }
      throw error;
    }
  }

  return false;
}

async function releaseOrderLock(lockName) {
  try {
    await OrderLock.deleteOne({ name: lockName });
  } catch (error) {
    console.error("Order lock release error:", error);
  }
}

module.exports = {
  OrderLock,
  acquireOrderLock,
  releaseOrderLock,
};
