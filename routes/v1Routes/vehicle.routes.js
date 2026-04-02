const express = require("express");
const { createVehicle } = require("../../controllers/vehicle/createVehicle");
const { listVehicle } = require("../../controllers/vehicle/listVehicle");
const { listbyVehicle } = require("../../controllers/vehicle/listbyVehicle");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const vehicleRoutes = express.Router();

vehicleRoutes.route("/create-vehicle").post(protectDisRoute, createVehicle);
vehicleRoutes.route("/list-vehicle").get(protect, listVehicle);
vehicleRoutes
  .route("/vehiclelist-by-distributor")
  .get(protectDisRoute, listbyVehicle);

module.exports = vehicleRoutes;
