const fs = require("fs");
const path = require("path");

// Create logs directory if not exists
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Function to get today's log file path
function getLogFilePath(dateString) {
  if (!dateString) {
    dateString = new Date().toISOString().split("T")[0];
  }
  return path.join(logsDir, `${dateString}.txt`);
}

// Function to write log
function writeLog(message) {
  const logFilePath = getLogFilePath();
  const log = `[${new Date().toISOString()}] ${message}\n`;

  fs.appendFile(logFilePath, log, (err) => {
    if (err) console.error("Log write error:", err);
  });
}

module.exports = { writeLog, getLogFilePath };