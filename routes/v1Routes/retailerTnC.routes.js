const express = require("express");
const {
  upsertRetailerTnC,
  getRetailerTnC,
} = require("../../controllers/retailertnc.controller");
const { protectRoute, authorizeRoles } = require("../../middlewares/protectRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const router = express.Router();

// Route for admin to update/create TnC
router.post("/upsert-retailer-tnc", protectRoute, authorizeRoles(), upsertRetailerTnC);

// Route for anyone to get TnC
router.get("/get-retailer-tnc",getRetailerTnC);

module.exports = router;
