const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Distributor = require("../../models/distributor.model");
const Brand = require("../../models/brand.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Bill = require("../../models/bill.model");
const Invoice = require("../../models/invoice.model");

const dbTransactionReport = asyncHandler(async (req, res) => {
  try {
    let {
      distributorId,
      distributorIds,
      brandIds,
      fromDate,
      toDate,
      startDate,  // For backward compatibility
      endDate,    // For backward compatibility
      search,
      transactionType,
      transactionFor,
      retailerId,
      status
    } = req.query;

    // Use fromDate/toDate if available, otherwise fallback to startDate/endDate for backward compatibility
    const actualFromDate = fromDate || startDate;
    const actualToDate = toDate || endDate;

    if (!actualFromDate || !actualToDate) {
      res.status(400);
      throw new Error("Missing required fields: fromDate/toDate or startDate/endDate");
    }

    // Convert date strings to Date objects with proper timezone handling
    const startOfDay = moment.tz(actualFromDate, "Asia/Kolkata").startOf("day").toDate();
    const endOfDay = moment.tz(actualToDate, "Asia/Kolkata").endOf("day").toDate();

    if (startOfDay > endOfDay) {
      res.status(400);
      throw new Error("Start date cannot be after end date");
    }

    // Build filter object similar to paginatedDistributorTransaction
    let filter = {};

    // Distributor filter
    if (distributorId) {
      filter.distributorId = distributorId;
    }

    // Date range filter on createdAt field - use the moment timezone dates already calculated
    if (actualFromDate) {
      if (!filter.createdAt) filter.createdAt = {};
      filter.createdAt.$gte = startOfDay;
    }
    if (actualToDate) {
      if (!filter.createdAt) filter.createdAt = {};
      filter.createdAt.$lte = endOfDay;
    }

    // Add search functionality similar to paginatedDistributorTransaction
    if (search) {
      const searchRegex = new RegExp(search, "i");
      const orConditions = [];

      // Try to find bill and invoice
      const bill = await Bill.findOne({
        billNo: { $regex: search, $options: "i" },
      });
      if (bill) {
        orConditions.push({ billId: bill._id });
      }

      const invoice = await Invoice.findOne({
        invoiceNo: { $regex: search, $options: "i" },
      });
      if (invoice) {
        orConditions.push({ invoiceId: invoice._id });
      }

      // _id search (only if valid ObjectId)
      if (/^[a-f\d]{24}$/i.test(search)) {
        orConditions.push({ _id: search });
      }

      // remark search
      orConditions.push({ remark: searchRegex });

      // Only add $or if there are conditions
      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    if (retailerId) {
      filter.retailerId = retailerId;
    }

    // Transaction type filter
    if (transactionType) {
      filter.transactionType = transactionType;
    }

    // Transaction for filter
    if (transactionFor) {
      filter.transactionFor = transactionFor;
    }

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Collect distributors to process
    let distributors = [];
    if (distributorId) {
      const distributor = await Distributor.findById(distributorId)
        .populate("stateId", "name")
        .populate("regionId", "name");
      if (!distributor) {
        res.status(404);
        throw new Error("Distributor not found");
      }
      distributors.push(distributor);
    }

    // if brandIds selected
    let query = {};
    if (brandIds) {
      if (brandIds === "all") {
        const brandAll = await Brand.find({}).sort({ _id: -1 });
        query.brandId = { $in: brandAll.map((b) => b._id.toString()) };
      } else {
        const brandIdArr = brandIds.split(",").map((id) => id.trim());
        query.brandId = { $in: brandIdArr };
      }
    }
    // if brandIds selected end

    if (distributorIds) {
      if (distributorIds === "all") {
        // Get all distributors from Distributor
        const distributorAll = await Distributor.find({}).sort({ _id: -1 });
        // take only the IDs into distributors
        const ids = distributorAll.map((distB) => distB._id.toString());
        query._id = { $in: ids };
      } else {
        const ids = distributorIds.split(",");
        query._id = { $in: ids };
      }
      // If distributorIds is provided but no specific distributorId, find based on query
      if (!distributorId) {
        const multiDistributors = await Distributor.find(query)
          .populate("stateId", "name")
          .populate("regionId", "name")
          .populate("brandId", "code");
        distributors.push(...multiDistributors);
      }
    }

    // If no distributors found from IDs, use the filter to determine which distributors to process
    if (!distributors.length) {
      // Extract unique distributor IDs from filtered transactions
      const filteredTransactionDistIds = await DistributorTransaction.distinct('distributorId', filter);
      if (filteredTransactionDistIds.length > 0) {
        distributors = await Distributor.find({ _id: { $in: filteredTransactionDistIds } })
          .populate("stateId", "name")
          .populate("regionId", "name")
          .populate("brandId", "code");
      } else {
        res.status(404);
        throw new Error("No distributors found");
      }
    }

    const fileName = `db-transaction-report-csp-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD")}.csv`;
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

    // Process each distributor separately
    for (const distributor of distributors) {
      // Update filter to include this specific distributor
      const distributorFilter = { ...filter, distributorId: distributor._id };

      const transactions = await DistributorTransaction.find(distributorFilter)
        .sort({ createdAt: 1 });

      // if (!transactions.length) continue; // skip if no data
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

      // Check if ANY transaction exists inside selected date range for this distributor
      const anyTransactionInRange = await DistributorTransaction.exists({
        ...distributorFilter,
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });

      // Skip only if:
      // 1. Opening balance before range = 0
      // 2. AND NO transactions at all in the selected range
      if (runningBalance === 0 && !anyTransactionInRange) {
        console.log(
          `Skipping Distributor ${distributor.name} — No opening balance & no activity in date range`
        );
        continue;
      }

      // Process each day in the date range
      const currentDate = moment.tz(startOfDay, "Asia/Kolkata");
      const endMoment = moment.tz(endOfDay, "Asia/Kolkata");

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
            dayTransactions[dayTransactions.length - 1].balance ??
            runningBalance;
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
    }
    csvStream.end();
  } catch (error) {
    console.error("DB Transaction Report Error:", {
      error: error.message,
      stack: error.stack,
      distributorId: req.query.distributorId,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      startDate: req.query.startDate,  // For backward compatibility
      endDate: req.query.endDate,      // For backward compatibility
      timestamp: new Date().toISOString(),
    });

    // Styled error HTML
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>DB Transaction Report Error</title>
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
              <h1>⚠️ DB Transaction Report Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the distributor transaction report. Please check your parameters and try again.</p>

              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Report Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Distributor ID:</strong> ${
                  req.query.distributorId || "N/A"
                }</p>
                <p><strong>From Date:</strong> ${req.query.fromDate || "N/A"}</p>
                <p><strong>To Date:</strong> ${req.query.toDate || "N/A"}</p>
                <p><strong>Start Date:</strong> ${req.query.startDate || "N/A"}</p>
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

module.exports = { dbTransactionReport };
