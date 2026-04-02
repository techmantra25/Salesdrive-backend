// queues/smsQueue.js
const { Queue } = require("bullmq");
const connection = require("../redisConnection");

const smsQueue = new Queue("sms", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

module.exports = smsQueue;