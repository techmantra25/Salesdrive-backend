const express = require("express");
const billRoutes = require("./v3Routes/bill.routes");
const v3Routes = express.Router();

v3Routes.use("/ping", async (req, res) => {
  res.status(200).json({
    status: 200,
    message: "v3 Routes are alive!",
  });
});


v3Routes.use("/bill", billRoutes);


module.exports = v3Routes;