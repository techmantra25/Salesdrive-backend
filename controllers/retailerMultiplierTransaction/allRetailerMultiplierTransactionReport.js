const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const RetailerMultiplierTransaction = require("../../models/retailerMultiplierTransaction.model");

const allRetailerMultiplierTransactionReport = asyncHandler(
  async (req, res) => {
    try {
      let {
        search,
        retailerId,
        transactionType,
        transactionFor,
        status,
        month,
        year,
        fromDate,
        toDate,
      } = req.query;

      // Build the filter object (same as pagination function)
      let filter = {};

      // Retailer filter
      if (retailerId) {
        filter.retailerId = retailerId;
      }

      if (search) {
        const searchRegex = new RegExp(search, "i");
        const orConditions = [];

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

      // Month filter
      if (month) {
        filter.month = parseInt(month, 10);
      }

      // Year filter
      if (year) {
        filter.year = parseInt(year, 10);
      }

      // Date range filter on createdAt field
      if (fromDate || toDate) {
        filter.createdAt = {};
        if (fromDate) {
          const startOfDay = new Date(fromDate);
          startOfDay.setHours(0, 0, 0, 0);
          filter.createdAt.$gte = startOfDay;
        }
        if (toDate) {
          const endOfDay = new Date(toDate);
          endOfDay.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = endOfDay;
        }
      }

      // Prepare CSV headers for retailer multiplier transaction
      const headers = [
        "Date",
        "Retailer Name",
        "Retailer UID",
        "Retailer Code",
        "Transaction Type",
        "Transaction For",
        "Slab Percentage",
        "Month Total Points",
        "Points",
        "Month",
        "Year",
        "Status",
        "Remark",
      ];

      const fileName = `retailer-multiplier-transactions-${moment()
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      const csvStream = format({ headers });
      csvStream.pipe(res);

      // Fetch all retailer multiplier transactions with filters (same sorting as pagination)
      const transactions = await RetailerMultiplierTransaction.find(filter)
        .sort({ updatedAt: -1 })
        .populate({
          path: "retailerId",
          select: "", // Same as pagination function
        });

      transactions.forEach((t) => {
        csvStream.write({
          Date: moment(t.createdAt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm:ss"),
          "Retailer Name": t.retailerId?.outletName || "",
          "Retailer UID": t.retailerId?.outletUID || "",
          "Retailer Code": t.retailerId?.outletCode || "",
          "Transaction Type": t.transactionType,
          "Transaction For": t.transactionFor,
          "Slab Percentage": t.slabPercentage,
          "Month Total Points": t.monthTotalPoints || "",
          Points: t.transactionType === "credit" ? t.point : -t.point,
          Month: t.month,
          Year: t.year,
          Status: t.status,
          Remark: t.remark || "",
        });
      });

      csvStream.end();
    } catch (error) {
      console.error(
        "Retailer Multiplier Transaction Report Error:",
        error.message
      );
      res.status(500).json({
        status: 500,
        message: "Failed to generate retailer multiplier transaction report",
        error: error.message,
      });
    }
  }
);

module.exports = { allRetailerMultiplierTransactionReport };
