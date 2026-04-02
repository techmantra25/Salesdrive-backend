const express = require("express");
const cloudinaryRoutes = express.Router();
const asyncHandler = require("express-async-handler");
const admin = require("firebase-admin");
const multer = require("multer");
const path = require("path");
const { BUCKET_URL } = require("../../config/server.config");

// Firebase Service Account
const serviceAccount = require("../../lux-dms-firebase-adminsdk.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: BUCKET_URL,
});

const bucket = admin.storage().bucket();

// Accepted file types for upload
const acceptedFileTypes = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
  "text/csv",
  "text/plain",
  "video/mp4",
  "video/webm",
  "video/avi",
  "video/mkv",
  "video/x-matroska",
  "application/x-matroska",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// Configure Multer
const upload = multer({
  storage: multer.memoryStorage(), // Store file in memory buffer
  fileFilter: (req, file, cb) => {
    if (!acceptedFileTypes.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only .png, .jpg, .jpeg, .pdf, .csv, .txt, .doc, .docx, .xlsx, .xls, .ppt, .pptx, .mp4, .mkv, .webm, .avi formats are allowed!"
        )
      );
    }
    cb(null, true);
  },
});

cloudinaryRoutes.post(
  "/upload",
  upload.single("my_file"),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        res.status(400);
        throw new Error("No file uploaded!");
      }

      const file = req.file;

      const name = req?.body?.fileName || "dms_" + Date.now();
      const fileName = name + path.extname(req.file.originalname);
      const filePath = `dms/${fileName}`;

      const blob = bucket.file(filePath);

      // Create a write stream
      const blobStream = blob.createWriteStream({
        resumable: false,
        metadata: {
          contentType: file.mimetype,
        },
      });

      blobStream.on("error", (err) => {
        res.status(500);
        throw err;
      });

      blobStream.on("finish", () => {
        // URL encode the file path
        const encodedFilePath = encodeURIComponent(filePath);

        // Generate the public URL
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedFilePath}?alt=media`;

        // Respond with the public URL
        res.status(200).send({
          fileName: fileName,
          secure_url: publicUrl,
          url: publicUrl,
          resource_type: "raw",
        });
      });

      blobStream.end(file.buffer);
    } catch (error) {
      res.status(400);
      throw error;
    }
  })
);

module.exports = cloudinaryRoutes;
