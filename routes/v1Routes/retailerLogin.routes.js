const express = require("express");

const retailerLogin = require("../../controllers/RetailerLogin/retailerLogin");
const verifyOtp = require("../../controllers/RetailerLogin/verifyOtp");
const resendOtp = require("../../controllers/RetailerLogin/resendOtp");
const storeDetail = require("../../controllers/RetailerLogin/storeDetail");
const retailerProfile = require("../../controllers/RetailerLogin/retailerProfile");
const walletBalance = require("../../controllers/RetailerLogin/waletBalance");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  loginRateLimiter,
  otpRateLimiter,
} = require("../../middlewares/rateLimiter.js");

const reatailerLoginRoutes = express.Router();

reatailerLoginRoutes.post("/login", loginRateLimiter, retailerLogin);
reatailerLoginRoutes.post("/check-otp", loginRateLimiter, verifyOtp);
reatailerLoginRoutes.post("/resend-otp", otpRateLimiter, resendOtp);
reatailerLoginRoutes.get("/store/list", storeDetail);
reatailerLoginRoutes.get("/user/profile/:id", retailerProfile);
reatailerLoginRoutes.get("/wallet/balance/:id", walletBalance);

module.exports = reatailerLoginRoutes;
