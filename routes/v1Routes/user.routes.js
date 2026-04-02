const express = require("express");

const {
  loginUser,
  logoutUser,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  getMe,
  userRegister,
} = require("../../controllers/user.controller.js");

const { protectRoute, isAdmin ,authorizeRoles} = require("../../middlewares/protectRoute.js");
const { loginRateLimiter } = require("../../middlewares/rateLimiter.js");

const { getAllUsers } = require("../../controllers/getUsers.js");
const { createUser } = require("../../controllers/createNewUSer.js");
const {
  updateUser,
  deleteUser,
} = require("../../controllers/modifyDeleteUser.js");
const { getAllPages } = require("../../controllers/user_access/getAllPages.js");
const { saveUserPermission } = require("../../controllers/user_access/saveUserPermission.js");
const { getUserPermission } = require("../../controllers/user_access/getUserPermission.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {createPage}= require ("../../controllers/user_access/addPage.js");

const userRoutes = express.Router();

// ================= AUTH =================
userRoutes
  .route("/login")
  .post(loginRateLimiter, loginUser);

userRoutes
  .route("/logout")
  .post(logoutUser);

userRoutes
  .route("/register")
  .post(userRegister);

// ================= PROFILE =================
userRoutes
  .route("/me")
  .get(protectRoute, getMe);

userRoutes
  .route("/update")
  .put(protectRoute, updateUserProfile);

// ================= PASSWORD =================
userRoutes
  .route("/forgot-password")
  .post(forgotPassword);

userRoutes
  .route("/reset-password/:resetToken")
  .patch(resetPassword);

// ================= USER MANAGEMENT (ADMIN) =================
userRoutes
  .route("/all-users")
  .get(protectRoute, authorizeRoles(), getAllUsers);

userRoutes
  .route("/create-user")
  .post(protectRoute,  authorizeRoles(), createUser);

// USER MANAGEMENT (ADMIN)
userRoutes
  .route("/:id")
  .put(protectRoute,  authorizeRoles(), updateUser)
  .delete(protectRoute,  authorizeRoles(), deleteUser);

  // userRoutes.route("/all-pages")
  // .get(protectRoute, getAllPages);

  userRoutes.route("/all-pages")
  .get(protect, getAllPages);

  userRoutes.route("/save-permissions")
  .post(protectRoute,  authorizeRoles(), saveUserPermission);

  userRoutes.route("/create-page")
  .post(protectRoute,  authorizeRoles(), createPage);


  // userRoutes
  // .route("/get-permissions/:userId")
  // .get(protectRoute,  authorizeRoles(), getUserPermission);

  userRoutes
  .route("/get-permissions/:userId")
  .get(protect, getUserPermission);
  
module.exports = userRoutes;
