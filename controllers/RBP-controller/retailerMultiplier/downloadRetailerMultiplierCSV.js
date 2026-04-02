// const asyncHandler = require("express-async-handler");
// const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
// const OutletApproved = require("../../../models/outletApproved.model");
// const { Parser } = require("json2csv"); // npm i json2csv
// const moment = require("moment-timezone");

// const downloadRetailerMultiplierCSV = asyncHandler(async (req, res) => {
//   try {
//     let { month, year } = req.query;

//     // Default to current month and year if not provided
//     const currentMoment = moment().tz("Asia/Kolkata");
//     if (!month) {
//       month = currentMoment.month() + 1;
//     }
//     if (!year) {
//       year = currentMoment.year();
//     }

//     month = parseInt(month, 10);
//     year = parseInt(year, 10);

//     if (month < 1 || month > 12) {
//       res.status(400);
//       throw new Error("Invalid month. It should be between 1 and 12.");
//     }

//     // Build query - fetch all transactions if no month/year filter
//     let query = {};
//     const hasMonthYearParams = req.query.month !== undefined || req.query.year !== undefined;

//     if (hasMonthYearParams) {
//       const startDate = moment
//         .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
//         .startOf("day")
//         .toDate();
//       const endDate = moment(startDate).endOf("month").toDate();

//       query = {
//         month,
//         year,
//         createdAt: { $gte: startDate, $lte: endDate },
//       };
//     }

//     // Fetch transactions
//     const transactions = await RetailerMultiplierTransaction.find(query)
//       .populate({ path: "retailerId", select: "outletName outletCode" })
//       .sort({ updatedAt: -1 });

//     if (!transactions.length) {
//       res.status(404);
//       throw new Error(hasMonthYearParams
//         ? "No transactions found for the selected month and year."
//         : "No transactions found.");
//     }

//     // Prepare CSV data
//     const csvData = transactions.map((txn) => ({
//       RetailerName: txn.retailerId?.outletName || "-",
//       RetailerUID: txn.retailerId?.outletUID || "-",
//       Month: moment().month(txn.month - 1).format("MMMM"), // e.g., "February"
//       Year: txn.year,
//       TransactionType: txn.transactionType,
//       TransactionFor: txn.transactionFor,
//       Points: txn.point,
//       SlabPercentage: txn.slabPercentage,
//       MonthTotalPoints: txn.monthTotalPoints || "-",
//       Status: txn.status,
//       Remark: txn.remark || "-",
//       CreatedAt: moment(txn.createdAt).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm"),
//     }));

//     // Convert JSON to CSV
//     const parser = new Parser({ fields: Object.keys(csvData[0]) });
//     const csv = parser.parse(csvData);

//     // Send CSV
//     res.header("Content-Type", "text/csv");
//     res.attachment(`RetailerMultiplier_${month}-${year}.csv`);
//     res.send(csv);
//   } catch (error) {
//     console.error("Error in downloadRetailerMultiplierCSV:", error.message);
//     res.status(500);
//     throw error;
//   }
// });

// module.exports = { downloadRetailerMultiplierCSV };

const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const { Parser } = require("json2csv");
const moment = require("moment-timezone");

const downloadRetailerMultiplierCSV = asyncHandler(async (req, res) => {
  try {
    let { month, year, retailerId, transactionFor } = req.query;

    let query = {};

    // Optional retailer filter
    if (retailerId) {
      query.retailerId = retailerId;
    }

    // Optional Transaction For filter
    if (transactionFor) {
      query.transactionFor = transactionFor;
    }

    // Optional month/year filter
    if (month && year) {
      month = parseInt(month, 10);
      year = parseInt(year, 10);

      if (month < 1 || month > 12) {
        res.status(400);
        throw new Error("Invalid month. It should be between 1 and 12.");
      }

      query.month = month;
      query.year = year;
    }

    // 🔥 Proper sorting (VERY IMPORTANT)
    const transactions = await RetailerMultiplierTransaction.find(query)
      .populate({
        path: "retailerId",
        select: "outletName outletUID outletCode",
      })
      .sort({
        retailerId: 1, // group retailer
        year: 1, // then year ascending
        month: 1, // then month ascending
        createdAt: 1, // then transaction order
      });

    if (!transactions.length) {
      res.status(404);
      throw new Error("No transactions found.");
    }

    // 🔥 CSV FORMAT (Exactly Your Format)
    const csvData = transactions.map((txn) => ({
      "Retailer Name": txn.retailerId?.outletName || "-",
      "Retailer UID": txn.retailerId?.outletUID || "-",
      "Retailer Code": txn.retailerId?.outletCode || "-",
      Year: txn.year,
      Month: moment()
        .month(txn.month - 1)
        .format("MMMM"),
      "Transaction For": txn.transactionFor,
      "Transaction Type": txn.transactionType,
      "MonthTotal Points": txn.monthTotalPoints || "-",
      "Multiplier Slab (%)": txn.slabPercentage || "-",
      "Multiplier Points": txn.point,
      Remark: txn.remark || "-",
      Status: txn.status,
      CreatedAt: moment(txn.createdAt)
        .tz("Asia/Kolkata")
        .format("DD-MM-YYYY HH:mm"),
    }));

    const parser = new Parser({ fields: Object.keys(csvData[0]) });
    const csv = parser.parse(csvData);

    // Set headers
    res.header("Content-Type", "text/csv");
    res.attachment("Retailer_Multiplier_Report.csv");
    res.send(csv);
  } catch (error) {
    console.error("Error in downloadRetailerMultiplierCSV:", error.message);
    res.status(500);
    throw error;
  }
});

module.exports = { downloadRetailerMultiplierCSV };
