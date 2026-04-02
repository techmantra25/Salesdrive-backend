const express = require("express");
const cors = require("cors");
const { PORT } = require("./config/server.configuration");
const v1Routes = require("./routes/v1.routes");
const connectDB = require("./database/dbConnect");
const {
  notFoundURL,
  errorHandlerCode,
} = require("./middlewares/allError.middleware");

// Initialize the Express app
const app = express();

// Connect to the database
connectDB();

// Middleware setup
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));
app.use(express.text());
app.use(cors());

// Health check route
app.get("/", (req, res) => {
  return res.status(200).json({
    error: false,
    status: 200,
    message: "Server is alive!..",
  });
});

// API routes
app.use("/api/v1/", v1Routes);

// Error handling middleware
app.use(notFoundURL);
app.use(errorHandlerCode);

// Start the server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
