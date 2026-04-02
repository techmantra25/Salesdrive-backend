const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const RBPreportForDistributor = asyncHandler(async (req, res) => {
  try {
    const { distributorId, startDate, endDate } = req.query;

    if (!distributorId || !startDate || !endDate) {
      res.status(400);
      throw new Error(
        "Missing required fields: distributorId, startDate, endDate"
      );
    }

    const startOfDay = moment
      .tz(startDate, "Asia/Kolkata")
      .startOf("day")
      .toDate();
    const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();

    if (startOfDay > endOfDay) {
      res.status(400);
      throw new Error("Start date cannot be after end date");
    }

    // Get distributor details
    const distributor = await Distributor.findById(distributorId)
      .populate("stateId", "name")
      .populate("regionId", "name")
      .populate("brandId", "code");

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const fileName = `db-ledger-report-${distributor.dbCode}-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const headers = [
      "Date",
      "DB Code",
      "DB Name",
      "DB State",
      "DB City",
      "Brands",
      "Opening Balance",
      "Opening Stock Point Credit",
      "GRN Invoice Point Credit",
      "Manual Point Credit",
      "Adjustment Stock Point Credit",
      "Retailer Return Point Credit",
      "Other Point Credit",
      "Opening Stock Point Debit",
      "GRN Return Point Debit",
      "Manual Point Debit",
      "Adjustment Stock Point Debit",
      "Retailer Sales Point Debit",
      "Other Point Debit",
      "Day Total Point",
      "Closing Balance",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    const currentDate = moment.tz(startOfDay, "Asia/Kolkata");
    const endMoment = moment.tz(endOfDay, "Asia/Kolkata");

    const transactions = await DistributorTransaction.find({
      distributorId: distributor._id,
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    }).sort({ createdAt: 1 });

    const brandCodes = distributor.brandId.map((b) => b.code).join(", ");

    const transactionsByDate = {};
    transactions.forEach((transaction) => {
      const dateKey = moment
        .tz(transaction.createdAt, "Asia/Kolkata")
        .format("YYYY-MM-DD");
      if (!transactionsByDate[dateKey]) {
        transactionsByDate[dateKey] = [];
      }
      transactionsByDate[dateKey].push(transaction);
    });

    const openingBalanceTransaction = await DistributorTransaction.findOne({
      distributorId: distributor._id,
      createdAt: { $lt: startOfDay },
    }).sort({ createdAt: -1 });

    let runningBalance = openingBalanceTransaction
      ? openingBalanceTransaction.balance
      : 0;

    while (currentDate.isSameOrBefore(endMoment, "day")) {
      const dateKey = currentDate.format("YYYY-MM-DD");
      const dayTransactions = transactionsByDate[dateKey] || [];

      let openingPointCredit = 0;
      let openingPointDebit = 0;
      let grnInvoicePointCredit = 0;
      let grnReturnPointDebit = 0;
      let manualStockPointCredit = 0;
      let manualStockPointDebit = 0;
      let adjustmentPointCredit = 0;
      let adjustmentPointDebit = 0;
      let retailerReturnPointCredit = 0;
      let retailerSalesPointDebit = 0;
      let otherPointCredit = 0;
      let otherPointDebit = 0;

      dayTransactions.forEach((transaction) => {
        const { transactionFor, transactionType, point } = transaction;
        switch (transactionFor) {
          case "Opening Points":
            transactionType === "credit"
              ? (openingPointCredit += point)
              : (openingPointDebit += point);
            break;
          case "GRN":
            transactionType === "credit"
              ? (grnInvoicePointCredit += point)
              : (grnReturnPointDebit += point);
            break;
          case "Purchase Return":
            transactionType === "credit"
              ? (grnInvoicePointCredit += point)
              : (grnReturnPointDebit += point);
            break;
          case "Manual Stock Point":
            transactionType === "credit"
              ? (manualStockPointCredit += point)
              : (manualStockPointDebit += point);
            break;
          case "Adjustment Point":
            transactionType === "credit"
              ? (adjustmentPointCredit += point)
              : (adjustmentPointDebit += point);
            break;
          case "Sales Return":
            if (transactionType === "credit") {
              retailerReturnPointCredit += point;
            }
            break;
          case "SALES":
          case "Sales Multiplier":
            if (transactionType === "debit") {
              retailerSalesPointDebit += point;
            }
            break;
          case "other":
            transactionType === "credit"
              ? (otherPointCredit += point)
              : (otherPointDebit += point);
            break;
        }
      });

      const totalDayCredit =
        openingPointCredit +
        grnInvoicePointCredit +
        manualStockPointCredit +
        adjustmentPointCredit +
        retailerReturnPointCredit +
        otherPointCredit;
      const totalDayDebit =
        openingPointDebit +
        grnReturnPointDebit +
        manualStockPointDebit +
        adjustmentPointDebit +
        retailerSalesPointDebit +
        otherPointDebit;

      const dayTotalPoints = totalDayCredit - totalDayDebit;

      const openingBalance = runningBalance;

      let closingBalance = runningBalance;
      if (dayTransactions.length > 0) {
        closingBalance =
          dayTransactions[dayTransactions.length - 1].balance ?? runningBalance;
      }
      runningBalance = closingBalance;

      csvStream.write({
        Date: currentDate.format("DD-MM-YYYY"),
        "DB Code": distributor.dbCode,
        "DB Name": distributor.name,
        "DB State": distributor.stateId?.name || "",
        "DB City": distributor.city || "",
        Brands: brandCodes || "",
        "Opening Balance": openingBalance,
        "Opening Stock Point Credit": openingPointCredit,
        "GRN Invoice Point Credit": grnInvoicePointCredit,
        "Manual Point Credit": manualStockPointCredit,
        "Adjustment Stock Point Credit": adjustmentPointCredit,
        "Retailer Return Point Credit": retailerReturnPointCredit,
        "Other Point Credit": otherPointCredit,
        "Opening Stock Point Debit": openingPointDebit,
        "GRN Return Point Debit": grnReturnPointDebit,
        "Manual Point Debit": manualStockPointDebit,
        "Adjustment Stock Point Debit": adjustmentPointDebit,
        "Retailer Sales Point Debit": retailerSalesPointDebit,
        "Other Point Debit": otherPointDebit,
        "Day Total Point": dayTotalPoints,
        "Closing Balance": closingBalance,
      });

      currentDate.add(1, "day");
    }

    csvStream.end();
  } catch (error) {
    console.error("DB Ledger Report Error:", {
      error: error.message,
      stack: error.stack,
      distributorId: req.query.distributorId,
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
          <title>DB Ledger Report Error</title>
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
              <h1>⚠️ DB Ledger Report Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the distributor ledger report. Please check your parameters and try again.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Ledger Report Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Distributor ID:</strong> ${
                  req.query.distributorId || "N/A"
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

module.exports = { RBPreportForDistributor };
