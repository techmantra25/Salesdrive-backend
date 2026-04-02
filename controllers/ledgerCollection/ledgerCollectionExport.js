const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const LedgerCollection = require("../../models/ledgerCollection.model");

const ledgerCollectionExport = asyncHandler(async (req, res) => {
  try {
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Ledger_Collection_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    // Set HTTP headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${fileName}\"`
    );

    // --- Start Filtering Logic (same as your list function) ---
    const filter = {};

    if (req.query.dbId) filter.distributorId = req.query.dbId;
    if (req.query.retailerId) filter.retailerId = req.query.retailerId;
    if (req.query.collectionType)
      filter.collectionType = req.query.collectionType;
    if (req.query.collectionNo) filter.collectionNo = req.query.collectionNo;

    if (req.query.fromDate || req.query.toDate) {
      filter.createdAt = {};

      if (req.query.fromDate) {
        const startOfDay = new Date(req.query.fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = startOfDay;
      }

      if (req.query.toDate) {
        const endOfDay = new Date(req.query.toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }
    // --- End Filtering Logic ---

    // Define which related documents to populate
    const populateFields = [
      { path: "distributorId", select: "name code" },
      { path: "retailerId", select: "name code" },
      { path: "lineItems.billId", select: "billNo billDate" },
    ];

    // Define CSV headers
    const headers = [
      "Collection No",
      "Collection Type",
      "Collection Date",
      "Distributor Name",
      "Distributor Code",
      "Retailer Name",
      "Retailer Code",
      "Bill No",
      "Bill Date",
      "Line Item Amount",
      "Description",
      "Status",
      "Payment Method",
      "Reference No",
      "Total Collection Amount",
      "Remarks",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for memory-efficient processing
    const cursor = LedgerCollection.find(filter)
      .populate(populateFields)
      .sort({ _id: -1 })
      .batchSize(500)
      .cursor();

    // Process each document from the cursor
    cursor.on("data", (collection) => {
      // Create a new CSV row for each line item
      if (collection.lineItems && collection.lineItems.length > 0) {
        collection.lineItems.forEach((item) => {
          csvStream.write({
            "Collection No": collection.collectionNo || "",
            "Collection Type": collection.collectionType || "",
            "Collection Date": collection.createdAt
              ? moment(collection.createdAt)
                  .tz("Asia/Kolkata")
                  .format("DD-MM-YYYY")
              : "",
            "Distributor Name": collection.distributorId?.name || "",
            "Distributor Code": collection.distributorId?.code || "",
            "Retailer Name": collection.retailerId?.name || "",
            "Retailer Code": collection.retailerId?.code || "",
            "Bill No": item.billId?.billNo || "",
            "Bill Date": item.billId?.billDate
              ? moment(item.billId.billDate)
                  .tz("Asia/Kolkata")
                  .format("DD-MM-YYYY")
              : "",
            "Line Item Amount": item.amount || 0,
            Description: item.description || "",
            Status: collection.status || "",
            "Payment Method": collection.paymentMethod || "",
            "Reference No": collection.referenceNo || "",
            "Total Collection Amount": collection.totalAmount || 0,
            Remarks: collection.remarks || "",
          });
        });
      } else {
        // If no line items, create single row
        csvStream.write({
          "Collection No": collection.collectionNo || "",
          "Collection Type": collection.collectionType || "",
          "Collection Date": collection.createdAt
            ? moment(collection.createdAt)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY")
            : "",
          "Distributor Name": collection.distributorId?.name || "",
          "Distributor Code": collection.distributorId?.code || "",
          "Retailer Name": collection.retailerId?.name || "",
          "Retailer Code": collection.retailerId?.code || "",
          "Bill No": "",
          "Bill Date": "",
          "Line Item Amount": 0,
          Description: "",
          Status: collection.status || "",
          "Payment Method": collection.paymentMethod || "",
          "Reference No": collection.referenceNo || "",
          "Total Collection Amount": collection.totalAmount || 0,
          Remarks: collection.remarks || "",
        });
      }
    });

    // Finalize the CSV stream when the cursor is finished
    cursor.on("end", () => {
      csvStream.end();
    });

    // Handle any errors during the database query
    cursor.on("error", (err) => {
      console.error("Error during report generation cursor:", err);
      csvStream.end();
      res.status(500).send("Error generating report");
    });
  } catch (error) {
    console.error("Error in ledgerCollectionCSVReport:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { ledgerCollectionExport };
