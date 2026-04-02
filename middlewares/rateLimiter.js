const rateLimit = require("express-rate-limit");

/**
 * Rate limiter middleware using express-rate-limit (memory store)
 * No Redis required - uses in-memory storage
 * Frontend compatible response format
 */

// Login rate limiter: 5 attempts per 15 minutes
const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    status: 429,
    error: true,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for OPTIONS requests (CORS preflight)
  skip: (req) => req.method === "OPTIONS",
});

// OTP rate limiter: 3 attempts per hour
const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 requests per windowMs
  message: {
    status: 429,
    error: true,
    message: "Too many OTP attempts. Please try again after 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});

// General API rate limiter: 100 requests per hour
const apiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 500, // Limit each IP to 500 requests per windowMs
  message: {
    status: 429,
    error: true,
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});

/**
 * Custom rate limiter factory for specific use cases
 * @param {number} maxRequests - Maximum number of requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @param {string} message - Custom error message
 * @returns {Function} Express middleware
 */
const rateLimiter = ({
  maxRequests = 5,
  windowMs = 15 * 60 * 1000,
  message = "Too many requests. Please try again later.",
} = {}) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: {
      status: 429,
      error: true,
      message: message,
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
  });
};

module.exports = {
  rateLimiter,
  loginRateLimiter,
  otpRateLimiter,
  apiRateLimiter,
};
