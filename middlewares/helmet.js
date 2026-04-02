const helmet = require("helmet");

/**
 * Helmet middleware configuration for security headers
 * Configured for DMS backend API - Frontend compatible
 */
const helmetConfig = helmet({
  // Content Security Policy - configure based on your needs
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://*.firebaseio.com", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: true,
  // Cross-Origin Opener Policy
  crossOriginOpenerPolicy: true,
  // Cross-Origin Resource Policy
  crossOriginResourcePolicy: { policy: "same-site" },
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // HSTS - disabled for development, enable in production with maxAge
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // No Sniff
  noSniff: true,
  // Origin Agent Cluster
  originAgentCluster: true,
  // Prevent clickjacking
  frameguard: { action: "deny" },
  // Referrer Policy
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  // X-XSS-Protection (legacy, but still useful for older browsers)
  xssFilter: true,
  // DNS Prefetch Control
  dnsPrefetchControl: { allow: false },
  // Permitted Cross-Origin Policies
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  // Remove X-Download-Options header (not needed for APIs)
  ieNoOpen: true,
});

module.exports = helmetConfig;
