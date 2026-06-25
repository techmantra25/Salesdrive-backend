const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/server.config");
const Distributor = require("../models/distributor.model");
const asyncHandler = require("express-async-handler");

// const protectDisRoute = asyncHandler(async (req, res, next) => {
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
//       req.user = await Distributor.findById(decoded.userId)
//         .populate([
//           {
//             path: "createdBy",
//             select: "",
//           },
//           {
//             path: "regionId",
//             select: "",
//           },
//           {
//             path: "stateId",
//             select: "",
//           },
//         ])
//         .select("-password -genPassword");

//       // ============ PORTAL LOCK CHECK FOR BILL DELIVERY ============
//       // Check if user is admin (they can bypass portal lock)
//       // Admin login uses genPassword, regular distributors use password
//       const isAdmin = req.user.role === "admin" || req.user.createdBy;

//       // Allow certain routes even if portal is locked
//       const allowedRoutesWhenLocked = [
//         "/api/v1/distributor/portal-status",
//         "/api/v1/distributor/pending-bills",
//         "/api/v1/distributor/overdue-bills-count",
//         "/api/v2/distributor/portal-status",
//         "/api/v2/distributor/pending-bills",
//         "/api/v2/distributor/overdue-bills-count",
//         "/api/v1/bill/deliver",
//         "/api/v2/bill/deliver",
//         "/api/v1/bill/detail",
//         "/api/v1/bill/bill_update",
//         "/api/v1/reason/list-by-module",
//         "/api/v1/reason/module",
//       ];

//       const requestPath = req.originalUrl || req.url;
//       const isAllowedRoute = allowedRoutesWhenLocked.some((route) =>
//         requestPath.includes(route),
//       );

//       // Check if portal is locked and route is not allowed
//       // BUT allow access if user is admin (logged in with genPassword)
//       if (req.user.isPortalLocked && !isAllowedRoute && !isAdmin) {
//         return res.status(403).json({
//           error: true,
//           isPortalLocked: true,
//           message: "Portal access restricted due to pending bill deliveries",
//           reason:
//             req.user.portalLockReason || "You have overdue bill deliveries",
//           portalLockedAt: req.user.portalLockedAt,
//           portalLockedBy: req.user.portalLockedBy,
//           pendingBillDeliveries: req.user.pendingBillDeliveries,
//           action: "Please deliver all pending bills to unlock portal access",
//         });
//       }
//       // ============ END PORTAL LOCK CHECK ============

//       next();
//     } catch (error) {
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

// module.exports = { protectDisRoute };

const protectDisRoute = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
  const token = req.cookies.DBToken || bearerToken;

  if (!token) {
    return res.status(401).json({
      error: true,
      message: "Not authorized, no token",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const distributor = await Distributor.findById(decoded.userId)
      .populate([
        { path: "createdBy" },
        { path: "regionId" },
        { path: "stateId" },
      ])
      .select("-password -genPassword");

    if (!distributor) {
      return res.status(401).json({
        error: true,
        message: "Distributor not found",
      });
    }

    req.user = distributor;

    // ============ PORTAL LOCK CHECK (DISABLED) ============
    // const isAdmin =
    //   distributor.role === "admin" ||
    //   (distributor.createdBy &&
    //     typeof distributor.createdBy === "object" &&
    //     distributor.createdBy._id);

    // console.log(
    //   `[Portal Lock Check] Distributor: ${distributor.name}, isAdmin: ${isAdmin}, isPortalLocked: ${distributor.isPortalLocked}, createdBy: ${distributor.createdBy ? "yes" : "no"}`,
    // );

    // const allowedRoutesWhenLocked = [
    //   "/api/v1/distributor/portal-status",
    //   "/api/v1/distributor/pending-bills",
    //   "/api/v1/distributor/overdue-bills-count",
    //   "/api/v2/distributor/portal-status",
    //   "/api/v2/distributor/pending-bills",
    //   "/api/v2/distributor/overdue-bills-count",
    //   "/api/v1/bill/deliver",
    //   "/api/v2/bill/deliver",
    //   "/api/v1/bill/detail",
    //   "/api/v1/bill/bill_update",
    //   "/api/v1/bill/paginated-bill-list",
    //   "/api/v1/bill/paginated_bill_report",
    //   "/api/v1/bill/paginated-order-to-bill-report",
    //   "/api/v1/bill/get-all",
    //   "/api/v1/bill/bill-status-date-update",
    //   "/api/v1/bill/create-single-bill",
    //   "/api/v1/bill/create-bulk-bill",
    //   "/api/v1/bill/bill-print",
    //   "/api/v1/bill/cancel_bill_update",
    //   "/api/v1/reason/list-by-module",
    //   "/api/v1/reason/module",
    //   "/api/v1/bill-delivery",
    //   "/api/v1/inventory",
    //   "/api/v1/product",
    //   "/api/v1/dashboard",
    //   "/api/v1/cart",
    //   "/api/v1/transaction",
    //   "/api/v1/ledger",
    // ];

    // const requestPath = req.originalUrl || req.url;
    // const isAllowedRoute = allowedRoutesWhenLocked.some((route) =>
    //   requestPath.includes(route),
    // );

    // console.log(
    //   `[Portal Lock Check] Path: ${requestPath}, isAllowedRoute: ${isAllowedRoute}`,
    // );

    // if (distributor.isPortalLocked && !isAllowedRoute && !isAdmin) {
    //   console.log(
    //     `[Portal Lock Check] BLOCKED: ${distributor.name} - portal locked, route not allowed, not admin`,
    //   );
    //   return res.status(403).json({
    //     error: true,
    //     isPortalLocked: true,
    //     message: "Portal access restricted due to pending bill deliveries",
    //     reason:
    //       distributor.portalLockReason || "You have overdue bill deliveries",
    //     portalLockedAt: distributor.portalLockedAt,
    //     portalLockedBy: distributor.portalLockedBy,
    //     pendingBillDeliveries: distributor.pendingBillDeliveries,
    //     action: "Please deliver all pending bills to unlock portal access",
    //   });
    // }

    // if (isAdmin) {
    //   console.log(
    //     `[Portal Lock Check] ADMIN BYPASS: ${distributor.name} - admin user, full access granted`,
    //   );
    // } else if (distributor.isPortalLocked && isAllowedRoute) {
    //   console.log(
    //     `[Portal Lock Check] ALLOWED ROUTE: ${distributor.name} - portal locked but route is allowed for delivery`,
    //   );
    // } else if (!distributor.isPortalLocked) {
    //   console.log(
    //     `[Portal Lock Check] UNLOCKED: ${distributor.name} - portal is unlocked, full access`,
    //   );
    // }
    // ============ END PORTAL LOCK CHECK (DISABLED) ============

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

module.exports = { protectDisRoute };
