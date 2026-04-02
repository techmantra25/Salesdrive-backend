const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const axios = require("axios");
const { format } = require("fast-csv");
const OutletApproved = require("../../models/outletApproved.model");
const {
  RBP_POINT_RETAILER_LEDGER_API,
} = require("../../config/retailerApp.config");
const Bill = require("../../models/bill.model");
const Distributor = require("../../models/distributor.model");

const retailerRewardLedger = asyncHandler(async (req, res) => {
  try {
    const { retailerId, startDate, endDate } = req.query;

    if (!retailerId || !startDate || !endDate) {
      res.status(400);
      throw new Error(
        "Missing required fields: retailerId, startDate, endDate"
      );
    }

    const retailer = await OutletApproved.findById(retailerId).populate(
      "stateId",
      ""
    );
    if (!retailer) {
      res.status(404);
      throw new Error("Retailer not found");
    }
    const retailerUID = retailer?.outletUID;
    const retailerName = retailer?.outletName || "";
    const state = retailer?.stateId?.name || "";
    const city = retailer?.city || "";

    // find out the distributor who have billed the most to this retailer in this time period
    // Use moment-timezone to set start and end in Asia/Kolkata timezone
    const start = moment.tz(startDate, "Asia/Kolkata").startOf("day").toDate();
    const end = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();

    const billingData = await Bill.find({
      retailerId: retailerId,
      createdAt: {
        $gte: start,
        $lte: end,
      },
    });

    const distributorBillingMap = {};
    billingData.forEach((bill) => {
      const distributorId = bill.distributorId.toString();
      const billAmount = parseFloat(bill.netAmount) || 0;
      if (distributorBillingMap[distributorId]) {
        distributorBillingMap[distributorId] += billAmount;
      } else {
        distributorBillingMap[distributorId] = billAmount;
      }
    });

    let topDistributorId = null;
    let maxBilledAmount = 0;
    for (const [distributorId, totalAmount] of Object.entries(
      distributorBillingMap
    )) {
      if (totalAmount > maxBilledAmount) {
        maxBilledAmount = totalAmount;
        topDistributorId = distributorId;
      }
    }

    const distributorInfo = await Distributor.findById(topDistributorId);
    if (!distributorInfo) {
      res.status(404);
      throw new Error(
        "No distributor found for this retailer in the given time period"
      );
    }

    const DBName = distributorInfo?.name;
    const DBCode = distributorInfo?.dbCode;

    const startOfDay = moment
      .tz(startDate, "Asia/Kolkata")
      .startOf("day")
      .toDate();
    const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();
    // add a day in the end date
    endOfDay.setDate(endOfDay.getDate() + 1);

    if (startOfDay > endOfDay) {
      res.status(400);
      throw new Error("Start date cannot be after end date");
    }

    const formattedStartDate = moment(startOfDay).format("YYYY-MM-DD");
    const formattedEndDate = moment(endOfDay).format("YYYY-MM-DD");

    // Fetch the retailer's reward ledger data
    const apiResponse = await axios.post(RBP_POINT_RETAILER_LEDGER_API, {
      retailer_uid: retailerUID,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
    });

    const data = apiResponse?.data?.data || [];

    if (data.length === 0) {
      res.status(404);
      throw new Error("No reward ledger data found for the given criteria");
    }

    const CSV_HEADER = [
      "Date",
      "Retailer code",
      "Retailer name",
      "Retailer state",
      "Retailer city",
      "DB Name",
      "DB Code",
      "Opening balance",
      "Sales Point Credit",
      "Multiplier Point Credit",
      "Redemption Cancellation Point Credit",
      "Manual Adjustment Point Credit",
      "Sales Return Point Debit",
      "Sales Return Multiplier Point Debit",
      "Gift Redemption Point Debit",
      "Manual Adjustment Point Debit",
      "Day Total Points",
      "Closing balance",
    ];

    // Generate CSV file name
    const fileName = `retailer-reward-ledger-${retailerUID}-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    // Set response headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Create CSV stream
    const csvStream = format({ headers: CSV_HEADER });
    csvStream.pipe(res);

    // Write each data row to CSV
    data.forEach((row) => {
      // Calculate Day Total Points (Credits - Debits)
      const totalCredits =
        (row["Sales Point Credit"] || 0) +
        (row["Multiplier Point Credit"] || 0) +
        (row["Redemption Cancellation Point Credit"] || 0) +
        (row["Manual Adjustment Point Credit"] || 0);

      const totalDebits =
        (row["Sales Return Point Debit"] || 0) +
        (row["Sales Return Multiplier Point Debit"] || 0) +
        (row["Gift Redemption Point Debit"] || 0) +
        (row["Manual Adjustment Point Debit"] || 0);

      const dayTotalPoints = totalCredits - totalDebits;

      csvStream.write({
        Date: row.Date,
        "Retailer code": row["Retailer code"],
        "Retailer name": row["Retailer name"],
        "Retailer state": row["Retailer state"],
        "Retailer city": row["Retailer city"],
        "DB Code": DBCode,
        "DB Name": DBName,
        "Opening balance": row["Opening balance"],
        "Sales Point Credit": row["Sales Point Credit"],
        "Multiplier Point Credit": row["Multiplier Point Credit"],
        "Redemption Cancellation Point Credit":
          row["Redemption Cancellation Point Credit"],
        "Manual Adjustment Point Credit": row["Manual Adjustment Point Credit"],
        "Sales Return Point Debit": row["Sales Return Point Debit"],
        "Sales Return Multiplier Point Debit":
          row["Sales Return Multiplier Point Debit"],
        "Gift Redemption Point Debit": row["Gift Redemption Point Debit"],
        "Manual Adjustment Point Debit": row["Manual Adjustment Point Debit"],
        "Day Total Points": dayTotalPoints,
        "Closing balance": row["Closing balance"],
      });
    });

    // End the CSV stream
    csvStream.end();
  } catch (error) {
    console.error("Retailer Reward Ledger Error:", {
      error: error.message,
      stack: error.stack,
      retailerId: req.query.retailerId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      timestamp: new Date().toISOString(),
    });

    // Styled error HTML
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Retailer Reward Ledger Error</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
              color: #333;
            }
            .error-container {
              max-width: 600px;
              margin: 50px auto;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              overflow: hidden;
            }
            .error-header {
              background: #d32f2f;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .error-header h1 {
              margin: 0;
              font-size: 24px;
            }
            .error-content {
              padding: 30px;
            }
            .error-details {
              background: #f8f9fa;
              border-left: 4px solid #d32f2f;
              padding: 15px;
              margin: 20px 0;
              border-radius: 0 4px 4px 0;
            }
            .error-details p {
              margin: 8px 0;
            }
            .error-details strong {
              color: #d32f2f;
            }
            .retry-section {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
            }
            .retry-button {
              display: inline-block;
              background: #1976d2;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 4px;
              font-weight: 500;
              transition: background 0.3s;
            }
            .retry-button:hover {
              background: #1565c0;
            }
            .support-info {
              margin-top: 20px;
              font-size: 14px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <div class="error-header">
              <h1>⚠️ Retailer Reward Ledger Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the retailer reward ledger. Please check your parameters and try again.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Ledger Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Retailer ID:</strong> ${
                  req.query.retailerId || "N/A"
                }</p>
                <p><strong>Start Date:</strong> ${
                  req.query.startDate || "N/A"
                }</p>
                <p><strong>End Date:</strong> ${req.query.endDate || "N/A"}</p>
                <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              </div>
              
              <div class="retry-section">
                <a href="javascript:location.reload()" class="retry-button">🔄 Try Again</a>
                
                <div class="support-info">
                  <p>If this error continues, please contact technical support with the error details above.</p>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.status(500).send(errorHtml);
  }
});

module.exports = { retailerRewardLedger };
