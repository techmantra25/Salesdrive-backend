const asyncHandler = require("express-async-handler");
const PriceCSV = require("../../models/priceCsv.model");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");

async function bulkAddPrice(file, token) {
  try {
    const response = await axios.post(
      `${SERVER_URL}/api/v1/bulk/save/Price`,
      { file },
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `token=${token}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('bulkAddPrice error:', error.response?.data || error.message);
    throw error;
  }
}

async function bulkUpdateStatus() {
  await axios.put(
    `${SERVER_URL}/api/v1/price/bulk-update-status`,
    {},
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

const priceCSVStatusUpdate = asyncHandler(async (req, res) => {
  try {
    const { id, status, modifiedURL } = req.body;

    // Get token from cookies
    const token = req.cookies.token || req.cookies.DBToken;
    if (!token) {
      return res.status(401).json({
        error: true,
        message: "Not authorized, no token",
      });
    }

    if (!id || !status) {
      res.status(400);
      throw new Error("ID and status are required");
    }

    if (status === "Modified & Uploaded" && !modifiedURL) {
      res.status(400);
      throw new Error(
        "Modified CSV URL is required for 'Modified & Uploaded' status"
      );
    }

    const priceCSV = await PriceCSV.findById(id);
    if (!priceCSV) {
      res.status(404);
      throw new Error("Price CSV not found");
    }

    if (status === "Approved & Uploaded" && !priceCSV.url.cronURL) {
      res.status(400);
      throw new Error("Cron URL is required for 'Approved & Uploaded' status");
    }

    let bulkAddData = null;
    if (status === "Modified & Uploaded") {
      bulkAddData = await bulkAddPrice(modifiedURL, token);
      const successRows = bulkAddData?.data || [];
      const failureRows = bulkAddData?.skippedRows || [];
      await bulkUpdateStatus();

      priceCSV.status = status;
      priceCSV.count.success = successRows.length;
      priceCSV.count.failure = failureRows.length;
      priceCSV.url.modifiedURL = modifiedURL;
    } else if (status === "Approved & Uploaded") {
      bulkAddData = await bulkAddPrice(priceCSV.url.cronURL, token);
      const successRows = bulkAddData?.data || [];
      const failureRows = bulkAddData?.skippedRows || [];
      await bulkUpdateStatus();

      priceCSV.status = status;
      priceCSV.count.success = successRows.length;
      priceCSV.count.failure = failureRows.length;
    } else if (status === "Canceled") {
      priceCSV.status = status;
    } else {
      res.status(400);
      throw new Error("Invalid status update");
    }

    const newPriceCSVData = await priceCSV.save();

    res.status(200).json({
      error: false,
      message: "Price CSV status updated successfully",
      data: { newPriceCSVData, ...(bulkAddData && { bulkAddData }) },
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { priceCSVStatusUpdate };
