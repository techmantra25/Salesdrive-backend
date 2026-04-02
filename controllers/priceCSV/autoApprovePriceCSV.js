const asyncHandler = require("express-async-handler");
const PriceCSV = require("../../models/priceCsv.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const User = require("../../models/user.model");
const generateToken = require("../../utils/generateToken");

const autoApprovePriceCSV = asyncHandler(async (req, res) => {
  try {
    const priceCSVs = await PriceCSV.find({ status: "Pending" }).sort({
      createdAt: 1, // Sort by creation date to process oldest first
    });

    if (priceCSVs.length === 0) {
      return res.status(200).json({
        status: 200,
        message: "No pending price CSVs to auto-approve",
        data: [],
      });
    }

    const adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
      return res.status(404).json({
        status: 404,
        message: "Admin user not found",
      });
    }

    const token = generateToken(adminUser._id);

    const results = [];
    for (const priceCSV of priceCSVs) {
      try {
        const id = priceCSV._id;
        const status = "Approved & Uploaded";

        await axios.post(
          `${SERVER_URL}/api/v1/price-csv/handle-status-update`,
          { id, status },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );
        results.push({ id, status: "success" });
      } catch (error) {
        console.error(
          `Error updating status for CSV ID ${priceCSV._id}:`,
          error.message
        );
        results.push({
          id: priceCSV._id,
          status: "error",
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      status: 200,
      message: "Auto-approve process completed",
      data: results,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { autoApprovePriceCSV };
