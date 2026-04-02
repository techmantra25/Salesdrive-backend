const express = require("express");
const v1Routes = express.Router();
<<<<<<< Updated upstream
=======
const importRoutes = require("./v1Routes/import.routes");
>>>>>>> Stashed changes

v1Routes.use("/ping", async (req, res) => {
  res.status(200).json({
    status: 200,
    message: "v1 Routes are alive!",
  });
});

<<<<<<< Updated upstream
=======
v1Routes.use("/imports", importRoutes);
>>>>>>> Stashed changes
module.exports = v1Routes;
