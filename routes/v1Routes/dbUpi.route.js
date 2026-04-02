const express = require("express");

const {
  createDbUpi,
  updateDbUpi,
  getDbUpi,
  deleteDbUpi,
} = require("../../controllers/dbUpi/dbUpi.js");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");

const dbUpiRoutes = express.Router();

dbUpiRoutes.route("/create-db-upi").post(protectDisRoute, createDbUpi);
dbUpiRoutes.route("/update-db-upi/:distributorId").patch(protectDisRoute, updateDbUpi);
dbUpiRoutes.route("/get-db-upi/:distributorId").get(protect, getDbUpi);
dbUpiRoutes.route("/delete-db-upi/:distributorId").delete(protectDisRoute, deleteDbUpi);

module.exports = dbUpiRoutes;
