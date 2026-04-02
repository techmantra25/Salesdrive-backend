const express = require("express");
const { saveCsvToDB } = require("../../controllers/fileUpload.controller.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  saveCsvToDB_v2,
} = require("../../controllers/fileUpload_v2.controller.js");

const fileUploadRoutes = express.Router();

fileUploadRoutes
  .route("/save/:csvType")
  .post(protect, saveCsvToDB);
fileUploadRoutes
  .route("/save_v2/:csvType")
  .post(protect, saveCsvToDB_v2);

module.exports = fileUploadRoutes;
