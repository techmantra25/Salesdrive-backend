const express = require("express");
const {
  importSapSecondaryOrders,
} = require("../../controllers/imports/importSapSecondaryOrders");


const importRoutes = express.Router();

importRoutes.get(
  "/import-sap-secondary-orders",
  importSapSecondaryOrders
);

module.exports = importRoutes;
