require("dotenv").config();
const IORedis = require("ioredis");

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  // ❌ DO NOT ADD tls
  maxRetriesPerRequest: null,
});

connection.on("connect", () => {
  console.log("✅ Redis connected");
});

connection.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

module.exports = connection;
