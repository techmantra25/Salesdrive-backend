const asyncHandler = require("express-async-handler");
const Ledger = require("../../models/ledger.model");
const mongoose = require("mongoose");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const ledgerReport = asyncHandler(async (req, res) => {
  try {
    console.log("Query parameters received:", req.query); // Debug log

    const now = moment().tz("Asia/Kolkata");
    const fileName = `Ledger_Report_${now.format("DD-MM-YYYY_hh-mm-ss-a")}.csv`;

    const filter = {};

    // --- Required Filters ---
    if (!req.query.dbId || !mongoose.Types.ObjectId.isValid(req.query.dbId)) {
      res.status(400);
      throw new Error("Valid dbId query parameter is required");
    }
    if (
      !req.query.retailerId ||
      !mongoose.Types.ObjectId.isValid(req.query.retailerId)
    ) {
      res.status(400);
      throw new Error("Valid retailerId query parameter is required");
    }
    filter.dbId = req.query.dbId;
    filter.retailerId = req.query.retailerId;

    // --- Optional Filters ---
    if (req.query.transactionType && req.query.transactionType !== "all") {
      if (["credit", "debit"].includes(req.query.transactionType)) {
        filter.transactionType = req.query.transactionType;
      }
    }

    if (req.query.transactionFor && req.query.transactionFor !== "all") {
      const validTransactionFor = [
        "Sales",
        "Sales-Credit-Adjustment",
        "Collection",
        "Collection-Discount",
        "Credit Note",
        "Debit Note",
        "Opening Balance",
        "Collection-Credit-Adjustment",
      ];
      if (validTransactionFor.includes(req.query.transactionFor)) {
        filter.transactionFor = req.query.transactionFor;
      }
    }

    // Date Range Filter
    if (req.query.fromDate || req.query.toDate) {
      filter.createdAt = {};
      if (req.query.fromDate) {
        const fromDate = new Date(req.query.fromDate);
        if (!isNaN(fromDate)) {
          fromDate.setHours(0, 0, 0, 0);
          filter.createdAt.$gte = fromDate;
        }
      }
      if (req.query.toDate) {
        const toDate = new Date(req.query.toDate);
        if (!isNaN(toDate)) {
          toDate.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = toDate;
        }
      }
      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    // Search Filter
    if (req.query.search && req.query.search.trim()) {
      const searchQuery = req.query.search.trim();
      filter.transactionId = { $regex: searchQuery, $options: "i" };
    }

    console.log("Final filter:", filter); // Debug log

    // Check if data exists before starting stream
    const count = await Ledger.countDocuments(filter);
    console.log("Total records found:", count); // Debug log

    // Set headers first
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const populateFields = [
      { path: "billId", select: "billNo" },
      { path: "collectionId", select: "collectionNo" },
      { path: "creditNoteId", select: "creditNoteNo" },
      { path: "retailerId", select: "outletCode outletName" },
      { path: "dbId", select: "dbCode name" },
    ];

    const headers = [
      "Transaction ID",
      "Distributor Code",
      "Distributor Name",
      "Retailer Code",
      "Retailer Name",
      "Transaction Type",
      "Transaction For",
      "Transaction Amount",
      "Balance",
      "Bill No",
      "Collection No",
      "Credit Note No",
      "Created Date",
      "Updated Date",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Handle sorting
    let sortOrder = -1; // Default descending
    if (req.query.sortBy === "asc") {
      sortOrder = 1;
    }

    const cursor = Ledger.find(filter)
      .populate(populateFields)
      .sort({ createdAt: sortOrder })
      .batchSize(1000)
      .cursor();

    let recordCount = 0;

    cursor.on("data", (ledger) => {
      recordCount++;
      // console.log(`Processing record ${recordCount}:`, ledger.transactionId); // Debug log

      csvStream.write({
        "Transaction ID": ledger?.transactionId || "",
        "Distributor Code": ledger?.dbId?.dbCode || "",
        "Distributor Name": ledger?.dbId?.name || "",
        "Retailer Code": ledger?.retailerId?.outletCode || "",
        "Retailer Name": ledger?.retailerId?.outletName || "",
        "Transaction Type": ledger?.transactionType || "",
        "Transaction For": ledger?.transactionFor || "",
        "Transaction Amount": ledger?.transactionAmount || 0,
        Balance: ledger?.balance || 0,
        "Bill No": ledger?.billId?.billNo || "",
        "Collection No": ledger?.collectionId?.collectionNo || "",
        "Credit Note No": ledger?.creditNoteId?.creditNoteNo || "",
        "Created Date": ledger?.createdAt
          ? moment(ledger.createdAt)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY HH:mm:ss")
          : "",
        "Updated Date": ledger?.updatedAt
          ? moment(ledger.updatedAt)
              .tz("Asia/Kolkata")
              .format("DD-MM-YYYY HH:mm:ss")
          : "",
      });
    });

    cursor.on("end", () => {
      // console.log(`CSV generation completed. Total records processed: ${recordCount}`); // Debug log
      csvStream.end();
    });

    cursor.on("error", (err) => {
      console.error("Cursor error:", err); // Debug log
      csvStream.end();
      if (!res.headersSent) {
        res.status(500).json({ error: "Error generating report" });
      }
    });
  } catch (error) {
    console.error("Report generation error:", error); // Debug log
    if (!res.headersSent) {
      res.status(400);
      throw error;
    }
  }
});

module.exports = {
  ledgerReport,
};
