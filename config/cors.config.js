/**
 * CORS Configuration
 * Add your allowed origins here
 */

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:5174",
    "http://localhost:4174",
    "http://localhost:5175",
    "https://rupa.mysalesdrive.in",
    "https://rupa.central.mysalesdrive.in",
    "https://testing-salesdrive-csp.netlify.app",
    "https://testing-salesdrive-dms.netlify.app",
    "https://rbp-rupa.netlify.app",
    "https://rbp-rupa-dms.netlify.app",
  

    "https://skipper-salesdrive-csp.netlify.app",
    "https://skipper-salesdrive-dms.netlify.app",


    // ADD THESE
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
    "http://localhost:8100",
    "http://localhost:8101",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["Set-Cookie"],
};

module.exports = { corsOptions };
