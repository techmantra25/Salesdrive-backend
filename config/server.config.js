const dotenv = require("dotenv");
dotenv.config();

const PORT = process.env.PORT;
const MONGODB_URI = process.env.MONGODB_URI;
const NODE_ENV = process.env.NODE_ENV;
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT;
const EMAIL_USERNAME = process.env.EMAIL_USERNAME;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const CLIENT_URL = process.env.CLIENT_URL;
const SERVER_URL = process.env.SERVER_URL;
const BUCKET_URL = process.env.BUCKET_URL;
const API_URL = process.env.API_URL;
const RUPA_USERNAME = process.env.RUPA_USERNAME;
const RUPA_PASSWORD = process.env.RUPA_PASSWORD;

module.exports = {
  JWT_SECRET,
  MONGODB_URI,
  NODE_ENV,
  PORT,
  SESSION_SECRET,
  EMAIL_HOST,
  EMAIL_PASSWORD,
  EMAIL_PORT,
  EMAIL_USERNAME,
  CLIENT_URL,
  SERVER_URL,
  BUCKET_URL,
  API_URL,
  RUPA_USERNAME,
  RUPA_PASSWORD,
};
