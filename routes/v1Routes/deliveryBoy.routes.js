const express = require("express");
const {
  createDeliveryBoy,
} = require("../../controllers/deliveryBoy/createDeliveryBoy");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  updateDeliveryBoy,
} = require("../../controllers/deliveryBoy/updateDeliveryBoy");
const {
  detailDeliveryBoy,
} = require("../../controllers/deliveryBoy/detailDeliveryBoy");
const {
  listDeliveryBoyByDistributor,
} = require("../../controllers/deliveryBoy/listDeliveryBoyByDistributor");

const deliveryBoyRoutes = express.Router();

deliveryBoyRoutes
  .route("/create-delivery-boy")
  .post(protectDisRoute, createDeliveryBoy);
deliveryBoyRoutes
  .route("/update-delivery-boy/:id")
  .patch(protectDisRoute, updateDeliveryBoy);
deliveryBoyRoutes.route("/detail-delivery-boy/:id").get(protect, detailDeliveryBoy);
deliveryBoyRoutes
  .route("/list-delivery-boy-by-distributor")
  .get(protectDisRoute, listDeliveryBoyByDistributor);

module.exports = deliveryBoyRoutes;
