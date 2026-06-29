const helmet = require("helmet");

/**
 * Helmet middleware configuration for security headers
 * Configured for DMS backend API - Frontend compatible
 */
const helmetConfig = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://firebasestorage.googleapis.com", // Firebase Storage — company logo + channel partner logos
      ],
      connectSrc: ["'self'", "https://*.firebaseio.com", "wss:", "ws:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  // Cross-Origin Embedder Policy — disabled so the HTML print page can load
  // cross-origin Firebase Storage images without being blocked
  crossOriginEmbedderPolicy: false,
  // Cross-Origin Opener Policy
  crossOriginOpenerPolicy: true,
  // Cross-Origin Resource Policy — must be cross-origin so the browser allows
  // Firebase Storage images to render inside the served HTML page
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // HSTS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  originAgentCluster: true,
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
  dnsPrefetchControl: { allow: false },
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  ieNoOpen: true,
});

module.exports = helmetConfig;