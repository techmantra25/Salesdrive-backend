const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/server.config");
const User = require("../models/user.model");
const RetailerLogin = require("../models/retailerLogin.model");
const Distributor = require("../models/distributor.model");
const asyncHandler = require("express-async-handler");

// /**
//  * Generic protect middleware that handles:
//  * - Admin/Employee users (User model)
//  * - Retailer users (RetailerLogin model)
//  * - Distributor users (Distributor model)
//  */
// const protect = asyncHandler(async (req, res, next) => {
//   const authHeader = req.cookies.token || req.headers["authorization"];

//   console.log(req.cookies.token);

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

//       // Try to find user in User model (admin/employee)
//       let user = await User.findById(decoded.userId).select("-password");

//       if (user) {
//         req.user = user;
//         req.userType = "user";
//       } else {
//         // Try RetailerLogin model
//         const retailer = await RetailerLogin.findById(decoded.userId).populate(
//           "outletApprovedId",
//         );
//         if (retailer) {
//           req.user = retailer;
//           req.userType = "retailer";
//         } else {
//           // Try Distributor model
//           const distributor = await Distributor.findById(decoded.userId);
//           if (distributor) {
//             req.user = distributor;
//             req.userType = "distributor";
//           } else {
//             return res.status(401).json({
//               error: true,
//               message: "User not found",
//             });
//           }
//         }
//       }

//       next();
//     } catch {
//       res.status(401);
//       throw new Error("Not authorized, token failed");
//     }
//   } else {
//     res.status(401);
//     throw new Error("Not authorized, no token");
//   }
// });

// module.exports = { protect };


const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies.token || req.cookies.DBToken;

  if (!token) {
    return res.status(401).json({
      error: true,
      message: "Not authorized, no token",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    let user = await User.findById(decoded.userId).select("-password");

    if (user) {
      req.user = user;
      req.userType = "user";
      return next();
    }

    const retailer = await RetailerLogin.findById(decoded.userId).populate(
      "outletApprovedId"
    );

    if (retailer) {
      req.user = retailer;
      req.userType = "retailer";
      return next();
    }

    const distributor = await Distributor.findById(decoded.userId);

    if (distributor) {
      req.user = distributor;
      req.userType = "distributor";
      return next();
    }

    return res.status(401).json({
      error: true,
      message: "User not found",
    });

  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        message: "Session expired. Please login again.",
      });
    }

    return res.status(401).json({
      error: true,
      message: "Token invalid or expired",
    });
  }
});

module.exports = { protect };