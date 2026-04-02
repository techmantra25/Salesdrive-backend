const express = require("express");
const {
  createEmployee,
  allEmployees,
  detailEmployee,
  updateEmployee,
  employeesByDesg,
  allEmployeesPaginated,
  mapBeatIdToEmployeeId,
  listByBeat,
  getEmployeeByDesignation,
  getEmployeesWorkingUnderByEmployeeId,
  getEmployeeReport,
  getEmployeeByDistributor,
  loginEmployee,
  getEmployeeProfile,
  updateEmployeePassword,
  sendEmployeeCredentialEmail,
  getEmployeePassword,
} = require("../../controllers/employee.controller");
const { protectRoute ,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const protectEmployeeRoute = require("../../middlewares/protectEmployeeRoute.js");
const { loginRateLimiter } = require("../../middlewares/rateLimiter.js");

const employeeRoutes = express.Router();

// Authentication routes
employeeRoutes.route("/login").post(loginRateLimiter, loginEmployee);
employeeRoutes.route("/profile").get(protectEmployeeRoute, getEmployeeProfile);
employeeRoutes
  .route("/update-password")
  .post(protectEmployeeRoute, updateEmployeePassword);

// Admin routes
employeeRoutes
  .route("/send-credential-email/:id")
  .post(protectRoute, authorizeRoles(), sendEmployeeCredentialEmail);
employeeRoutes
  .route("/get-employee-password/:id")
  .get(protectRoute, authorizeRoles(), getEmployeePassword);
employeeRoutes.route("/create").post(protectRoute, authorizeRoles(), createEmployee);
employeeRoutes.route("/list").get(protect, allEmployees);
employeeRoutes.route("/all-list-paginated").get(protect, allEmployeesPaginated);
employeeRoutes.route("/detail/:id").get(protect, detailEmployee);
employeeRoutes
  .route("/map-beat-id-to-employee-id/:id")
  .patch(protectRoute, authorizeRoles(), mapBeatIdToEmployeeId);
employeeRoutes
  .route("/update/:id")
  .patch(protectRoute, authorizeRoles(), updateEmployee);
employeeRoutes.route("/list-by-desg/:desgId").get(protect, employeesByDesg);
employeeRoutes.route("/employee-by-designation").get(protect, getEmployeeByDesignation);
employeeRoutes.route("/list-by-beat/:beatId").get(protect, listByBeat);
employeeRoutes
  .route("/list-employees-working-under/:id")
  .get(protect, getEmployeesWorkingUnderByEmployeeId);
employeeRoutes.route("/employee-report").get(protect, getEmployeeReport);
employeeRoutes
  .route("/employee-by-distributor/:did")
  .get(protect, getEmployeeByDistributor);

module.exports = employeeRoutes;
