const express = require("express");
const { createSalesReturn } = require("../../controllers/RBP-controller/salesReturn/createSalesReturn");
const { createSalesReturnBulk } = require("../../controllers/RBP-controller/salesReturn/createSalesReturnBulk");
const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const salesReturnRoutes = express.Router();

salesReturnRoutes.post("/create-sales-return", protectDisRoute, createSalesReturn);
salesReturnRoutes.post("/create-sales-return-bulk", protectDisRoute, createSalesReturnBulk);




module.exports = salesReturnRoutes;
