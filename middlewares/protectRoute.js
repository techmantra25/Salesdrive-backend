const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/server.config");
const User = require("../models/user.model");
const asyncHandler = require("express-async-handler");

// const protectRoute = asyncHandler(async (req, res, next) => {
//   const authHeader = req.headers["authorization"];

//   if (!authHeader) {
//     return res.status(401).send({
//       error: true,
//       message: "Not authorized, no Header",
//     });
//   }

//   const token = authHeader && authHeader.split(" ")[1];

//   if (token == null) {
//     return res.status(401).send({
//       error: true,
//       message: "Not authorized, no token",
//     });
//   }

//   if (token) {
//     try {
//       const decoded = jwt.verify(token, JWT_SECRET);

//       req.user = await User.findById(decoded.userId).select("-password");

//       next();

//     } catch {
//       res.status(401);
//       if (error.name === "TokenExpiredError") {
//         throw new Error("Session expired. Please login again.");
//       }
//       throw new Error("Not authorized, token failed");
//     }
//   } else {
//     res.status(401);
//     throw new Error("Not authorized, no token");
//   }
// });

const protectRoute = asyncHandler(async (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({
      error: true,
      message: "Not authorized, no token",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({
        error: true,
        message: "User not found",
      });
    }

    req.user = user;
    next();
  } catch (error) {
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

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({
        error: true,
        message: "Not authenticated"
      });
    }


    if (allowedRoles.length === 0) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: true,
        message: "Not authorized to access this route"
      });
    }

    next();
  };
};


const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next();
  } else {
    res.status(401);
    throw new Error("Not authorized as an admin");
  }
};

module.exports = { protectRoute, authorizeRoles, isAdmin };
