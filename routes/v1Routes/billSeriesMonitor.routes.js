const express = require("express");
const {
  createBillSeriesMonitor,
  getBillSeriesMonitors,
  getBillSeriesMonitorsByDistributorId,
  getBillSeriesMonitorById,
  updateBillSeriesMonitor,
  deleteBillSeriesMonitor,
} = require("../../controllers/billSeriesMonitor.controller.js");

const billSeriesMonitorRoutes = express.Router();

billSeriesMonitorRoutes.route("/create").post(createBillSeriesMonitor);
billSeriesMonitorRoutes.route("/list").get(getBillSeriesMonitors);
billSeriesMonitorRoutes.route("/list/:distributorId").get(getBillSeriesMonitorsByDistributorId);
billSeriesMonitorRoutes.route("/detail/:id").get(getBillSeriesMonitorById);
billSeriesMonitorRoutes.route("/update/:id").patch(updateBillSeriesMonitor);
billSeriesMonitorRoutes.route("/delete/:id").delete(deleteBillSeriesMonitor);

module.exports = billSeriesMonitorRoutes;