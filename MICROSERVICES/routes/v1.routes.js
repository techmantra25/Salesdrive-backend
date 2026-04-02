const express = require("express");
const v1Routes = express.Router();

v1Routes.use("/ping", async (req, res) => {
  res.status(200).json({
    status: 200,
    message: "v1 Routes are alive!",
  });
});

module.exports = v1Routes;
