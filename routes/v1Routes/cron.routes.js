const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  getCronLogs,
  getCronLogById,
  getCronSummary,
} = require("../../jobs/crons/Cronlog.controller.js");


const cronRoutes = express.Router();

// ---------- logs (read) ----------
// NOTE: "/logs/summary" must stay above "/logs/:id", otherwise "summary" is read as an id
cronRoutes.route("/logs/summary").get(protect, getCronSummary);
cronRoutes.route("/logs").get(protect, getCronLogs);
cronRoutes.route("/logs/:id").get(protect, getCronLogById);


module.exports = cronRoutes;