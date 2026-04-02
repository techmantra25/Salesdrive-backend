const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Employee = require("../models/employee.model");
const { JWT_SECRET } = require("../config/server.config");
const User = require("../models/user.model");

const protectAdminOrEmployeeRoute = asyncHandler(async (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({
      error: true,
      message: "Not authorized, no token",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get employee from the token
    const employee = await Employee.findById(decoded.userId)
      .populate("desgId")
      .populate("zoneId")
      .populate("regionId")
      .populate("brandId")
      .select("-password")
      .lean();

    // Get user from the token
    const admin = await User.findById(decoded.userId)
      .select("-password")
      .lean();

    if (!employee && !admin) {
      return res.status(401).json({
        error: true,
        message: "Not authorized, employee not found",
      });
    }

    if (admin && admin.role !== "admin") {
      return res.status(401).json({
        error: true,
        message: "Not authorized, user not authorized as admin",
      });
    }

    req.user = employee ? employee : admin;

    next();
  } catch (error) {
    console.error(error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        message: "Session expired. Please login again.",
      });
    }

    return res.status(401).json({
      error: true,
      message: "Not authorized, token failed",
    });
  }
});

module.exports = protectAdminOrEmployeeRoute;
