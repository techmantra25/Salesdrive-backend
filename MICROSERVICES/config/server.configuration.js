const dotenv = require("dotenv");
dotenv.config();

const PORT = process.env.PORT;
const MONGODB_URI = process.env.MONGODB_URI;
const NODE_ENV = process.env.NODE_ENV;
const API_URL = process.env.API_URL;
const SERVER_URL = process.env.SERVER_URL;
const CLIENT_URL = process.env.CLIENT_URL;

module.exports = {
  MONGODB_URI,
  NODE_ENV,
  PORT,
  API_URL,
  SERVER_URL,
  CLIENT_URL,
};
