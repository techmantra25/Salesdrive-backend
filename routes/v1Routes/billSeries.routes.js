const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  updateBillSeries,
} = require("../../controllers/billSeries/updateBillSeries");
const { getBillSeries } = require("../../controllers/billSeries/getBillSeries");

const billSeriesRoutes = express.Router();

billSeriesRoutes.route("/get-bill-series").get(protect, getBillSeries);
billSeriesRoutes.route("/update-bill-series").patch(protectDisRoute, updateBillSeries);

module.exports = billSeriesRoutes;
