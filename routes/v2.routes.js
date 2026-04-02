const express = require("express");
const salesReturnRoutes = require("./v2Routes/salesReturn.routes");
const billRoutes = require("./v2Routes/bill.routes");
const retailerMultiplierTransactionRoutes = require("./v2Routes/retailerMultiplierTransaction.routes");
const distributorTransactionRouter = require("./v2Routes/distributorTransaction.routes");
const retailerMultiplierTransactionShadowRouter = require("./v2Routes/retailerMultiplierTransactionShadow.route");
const v2Routes = express.Router();

v2Routes.use("/ping", async (req, res) => {
  res.status(200).json({
    status: 200,
    message: "v2 Routes are alive!",
  });
});

v2Routes.use("/sales-return", salesReturnRoutes);
v2Routes.use("/bill", billRoutes);
v2Routes.use("/retailer-transaction", retailerMultiplierTransactionRoutes);
v2Routes.use("/db-transaction", distributorTransactionRouter);
v2Routes.use(
  "/retailerMultiplier-shadow",
  retailerMultiplierTransactionShadowRouter,
);

module.exports = v2Routes;
