const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const LedgerCollection = require("../../models/ledgerCollection.model"); // Adjust path to your model

const generateLedgerCollectionReport = asyncHandler(async (req, res) => {
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

    // --- Start Filtering Logic ---
    const filter = {};

    // Distributor filter
    if (req.query.distributorId) {
      filter.distributorId = req.query.distributorId;
    }
    if (req.query.distributorIds) {
      const distributorIds = req.query.distributorIds.split(",");
      if (distributorIds.length > 0) {
        filter.distributorId = { $in: distributorIds };
      }
    }

    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }
    // --- End Filtering Logic ---

    // Define which related documents to populate, including the new credit note details
    const populateFields = [
      { path: "distributorId", select: "dbCode name" },
      { path: "retailerId", select: "outletUID outletName" },
      { path: "lineItems.billId", select: "billNo netAmount" },
      {
        path: "lineItems.creditNoteAdjusted.creditNoteId",
        select: "creditNoteNo", // Select the credit note number
        model: "CreditNote", // Explicitly defining the model is good practice
      },
    ];

    // Define updated CSV headers
    const headers = [
      "DB Code",
      "DB Name",
      "Collection No",
      "Collection Type",
      "Retailer UID",
      "Retailer Name",
      "Bill No",
      "Bill Amount",
      "Collection Amount",
      "Discount Amount",
      "Collection Mode",
      "Credit Note No (s)", // New Field
      "Adjusted Credit Note Amount", // New Field
      "Collection Date",
      "Collected By",
      "Transaction ID",
      "Remarks", // New Field
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for memory-efficient processing
    const cursor = LedgerCollection.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(500)
      .cursor();

    // Process each document from the cursor
    cursor.on("data", (ledgerCollection) => {
      // Create a new CSV row for each line item (bill)
      ledgerCollection.lineItems.forEach((item) => {
        let collectionDate = "";
        let collectedBy = "";
        let transactionId = "";

        // Extract details based on the collection mode
        switch (item.collectionMode) {
          case "cash":
            collectionDate = item.cash?.collectionDate;
            collectedBy = item.cash?.collectionBy || "";
            break;
          case "cheque":
            collectionDate = item.cheque?.collectionDate;
            collectedBy = item.cheque?.collectionBy || "";
            transactionId = item.cheque?.chequeNumber || "";
            break;
          case "bank_transfer":
            collectionDate = item.bank_transfer?.collectionDate;
            collectedBy = item.bank_transfer?.collectionBy || "";
            transactionId = item.bank_transfer?.transactionId || "";
            break;
          case "upi":
            collectionDate = item.upi?.collectionDate;
            collectedBy = item.upi?.collectionBy || "";
            transactionId = item.upi?.transactionId || "";
            break;
        }

        // --- New Logic: Aggregate Credit Note data ---
        let creditNoteNumbers = "";
        let totalCreditNoteAmount = 0;
        if (item.creditNoteAdjusted && item.creditNoteAdjusted.length > 0) {
          const numbers = [];
          item.creditNoteAdjusted.forEach((cn) => {
            if (cn.creditNoteId && cn.creditNoteId.creditNoteNo) {
              numbers.push(cn.creditNoteId.creditNoteNo);
            }
            totalCreditNoteAmount += cn.amount || 0;
          });
          creditNoteNumbers = numbers.join(", "); // Join multiple CN numbers
        }

        // Write the row to the CSV stream
        csvStream.write({
          "DB Code": ledgerCollection.distributorId?.dbCode || "",
          "DB Name": ledgerCollection.distributorId?.name || "",
          "Collection No": ledgerCollection.collectionNo || "",
          "Collection Type": ledgerCollection.collectionType || "",
          "Retailer UID": ledgerCollection.retailerId?.outletUID || "",
          "Retailer Name": ledgerCollection.retailerId?.outletName || "",
          "Bill No": item.billId?.billNo || "",
          "Bill Amount": item.billId?.netAmount || 0,
          "Collection Amount": item.collectionAmount || 0,
          "Discount Amount": item.discountAmount || 0,
          "Collection Mode": item.collectionMode || "",
          "Credit Note No (s)": creditNoteNumbers, // Add aggregated CN numbers
          "Adjusted Credit Note Amount": totalCreditNoteAmount, // Add total CN amount
          "Collection Date": collectionDate
            ? moment(collectionDate).tz("Asia/Kolkata").format("DD-MM-YYYY")
            : "",
          "Collected By": collectedBy,
          "Transaction ID": transactionId,
          Remarks: item.remarks || "", // Add remarks
        });
      });
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
    console.error("Error in generateLedgerCollectionReport:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { generateLedgerCollectionReport };
