const { default: mongoose } = require("mongoose");
const { MONGODB_URI } = require("../config/server.configuration");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGODB_URI);
    const dbName = conn.connection.db.databaseName;
    console.log(`Connected to database: ${dbName}`);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
