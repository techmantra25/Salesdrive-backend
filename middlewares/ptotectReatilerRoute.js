const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const OutletApproved = require("../models/outletApproved.model");
const { JWT_SECRET } = require("../config/server.config");

const protectRetailerRoute = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Get retailer from the token
      const retailer = await OutletApproved.findById(decoded.outletApprovedId)
        .populate("zoneId")
        .populate("regionId")
        .populate("stateId")
        .populate("distributorId")
        .populate("beatId")
        .populate("sellingBrands")
        .select("-password");

      if (!retailer) {
        res.status(401);
        throw new Error("Not authorized, retailer not found");
      }

      req.user = retailer._id;

      next();
    } catch (error) {
      console.error(error);
      res.status(401);
      if (error.name === "TokenExpiredError") {
        throw new Error("Session expired. Please login again.");
      }
      throw new Error("Not authorized, token failed");
    }
  } else {
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});

module.exports = protectRetailerRoute;
