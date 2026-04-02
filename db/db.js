const mongoose = require("mongoose");
const { MONGODB_URI } = require("../config/server.config");

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log("MongoDB already connected. Reusing existing connection.");
    return;
  }

  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 100,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 300000,
      maxIdleTimeMS: 30000,
    });

    isConnected = mongoose.connection.readyState === 1;

    console.log("MongoDB Connected:", conn.connection.host);
    console.log("Database:", conn.connection.db.databaseName);
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
