const OutletApproved = require("../../models/outletApproved.model");
const fs = require("fs");
const path = require("path");

// Function to format a single outlet record for CSV
const formatOutletForCSV = (outlet) => {
  return {
    "Outlet Code": outlet.outletCode || "",
    "Outlet UID": outlet.outletUID || "",
    "Outlet Name": outlet.outletName || "",
    "Owner Name": outlet.ownerName || "",
    "Mobile 1": outlet.mobile1 || "",
    "Status": outlet.status ? "Active" : "Inactive"
  };
};

// Function to convert a single record to CSV row
const recordToCSVRow = (record, headers) => {
  return headers.map(header => {
    let value = record[header];
    if (value === null || value === undefined) {
      return '""';
    }
    value = String(value);
    // Escape quotes and wrap in quotes if value contains commas, quotes, or newlines
    if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
      value = '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }).join(",");
};

// Controller function to download approved outlets as CSV using batch processing
const downloadActiveOutlets = async (req, res) => {
  try {
    // Extract status from query parameters (defaults to true if not provided)
    const status = req.query.status !== undefined ? req.query.status === 'true' : true;

    // Set response headers for CSV download
    const fileName = status ? "active-approved-outlets.csv" : "inactive-approved-outlets.csv";
    res.header("Content-Type", "text/csv");
    res.attachment(fileName);

    // Batch processing configuration
    const batchSize = 1000; // Process 1,000 records at a time
    let skip = 0;
    let isFirstBatch = true;

    // Process records in batches
    while (true) {
      // Fetch a batch of outlets based on status
      const batch = await OutletApproved.find({ status: status })
        .select("outletCode outletUID outletName ownerName mobile1 status") // Only select required fields
        .skip(skip)
        .limit(batchSize)
        .lean(); // Use lean() to improve performance

      // Break if no more records
      if (!batch || batch.length === 0) {
        break;
      }

      // Process this batch
      const csvRows = [];

      // Add headers only for the first batch
      if (isFirstBatch) {
        const sampleRecord = formatOutletForCSV(batch[0]);
        const headers = Object.keys(sampleRecord);
        csvRows.push(headers.join(","));
        isFirstBatch = false;
      }

      // Format each record and convert to CSV row
      for (const outlet of batch) {
        const formattedRecord = formatOutletForCSV(outlet);
        const csvRow = recordToCSVRow(formattedRecord, Object.keys(formattedRecord));
        csvRows.push(csvRow);
      }

      // Send this batch to client
      if (skip === 0) {
        // First batch: send headers and data
        res.write(csvRows.join("\n") + "\n");
      } else {
        // Subsequent batches: send only data (headers already sent)
        res.write(csvRows.slice(1).join("\n") + "\n"); // slice(1) to skip headers
      }

      skip += batchSize;
    }

    // End the response
    res.end();

  } catch (error) {
    console.error("Error downloading approved outlets:", error);
    // Note: Since we might have already sent headers/data, we can't send a proper error response
    // Log the error for debugging
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Error downloading approved outlets",
        error: error.message,
      });
    }
  }
};

module.exports = {
  downloadActiveOutlets,
};
