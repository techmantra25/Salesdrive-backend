// workers/sms.worker.js
const { Worker } = require("bullmq");
const axios = require("axios");
const connection = require("../redisConnection");

const smsWorker = new Worker(
  "sms",
  async (job) => {
    const { contact, message } = job.data;

    const params = {
      UserId: process.env.SMS_USER_ID,
      pwd: process.env.SMS_PASSWORD,
      Message: message,
      Contacts: contact,
      SenderId: process.env.SMS_SENDER_ID,
      ServiceName: process.env.SMS_SERVICE_NAME,
      MessageType: 1,
      DLTTemplateId: process.env.SMS_DLT_TEMPLATE_ID,
    };

    await axios.get(process.env.SMS_URL, { params });

    console.log("✅ SMS sent to", contact);
  },
  {
    connection,
    concurrency: 20,
  }
);

module.exports = smsWorker;