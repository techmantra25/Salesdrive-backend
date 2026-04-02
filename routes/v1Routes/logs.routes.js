const express = require("express");
const { listLogs, downloadLog, viewLog } = require("../../controllers/logs.controller");
const { protect } = require("../../middlewares/auth.middleware.js");

const router = express.Router();

// GET /api/v1/logs - List all available log files
router.get("/", protect, listLogs);

// GET /api/v1/logs/view/:date - View log file in browser
router.get("/view/:date", protect, viewLog);

// GET /api/v1/logs/download/:date - Download specific log file
router.get("/download/:date", protect, downloadLog);

module.exports = router;
