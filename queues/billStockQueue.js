// queues/billStockQueue.js
const { Queue } = require("bullmq");
const connection = require("../redisConnection");

const MAX_QUEUE_DEPTH = 500;

const billStockQueue = new Queue("billing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: {
      age: 86400, // keep failed jobs for 1 day for debugging
      count: 500, // max 500 failed jobs in queue
    },
  },
});

const canEnqueue = async () => {
  try {
    const counts = await billStockQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
    );
    const total = counts.waiting + counts.active + counts.delayed;
    return total < MAX_QUEUE_DEPTH;
  } catch (err) {
    // Redis is down or unreachable — signal fallback
    console.warn(
      "⚠️ Redis health check failed, will use direct path:",
      err.message,
    );
    return false;
  }
};

module.exports = {billStockQueue, canEnqueue};
