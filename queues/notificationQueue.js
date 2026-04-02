const { Queue } = require("bullmq");
const connection = require("../redisConnection");

const notificationQueue = new Queue("notifications", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: {
      age: 86400, // keep failed jobs for 1 day
      count: 1000, // max 1000 failed jobs
    },
  },
});

module.exports = notificationQueue;
