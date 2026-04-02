const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Transaction = require("../../models/transaction.model");

const viewAllTransactionReport = asyncHandler(async (req, res) => {
  try {
    const {
      searchTerm,
      type,
      stockType,
      toDate,
      fromDate,
      transactionFor,
      distributorId, // can be: undefined | "all" | "id" | "id1,id2,id3"
    } = req.query;

    // -----------------------------
    // 1. BUILD MONGODB FILTER QUERY
    // -----------------------------
    const matchStage = {};

    // ✅ Distributor filter: supports ALL + MULTIPLE
    if (distributorId && distributorId !== "all") {
      const ids = String(distributorId)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (ids.length === 1) {
        matchStage.distributorId = ids[0]; // Mongoose will cast to ObjectId
      } else if (ids.length > 1) {
        matchStage.distributorId = { $in: ids };
      }
    }
    // else → no distributor filter = ALL distributors

    // ✅ Date filtering (createdAt as in your original code)
    if (fromDate || toDate) {
      matchStage.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = endOfDay;
      }
    }

    if (type && type !== "all") matchStage.type = type;
    if (stockType && stockType !== "all") matchStage.stockType = stockType;
    if (transactionFor && transactionFor !== "all") {
      matchStage.transactionType = transactionFor;
    }

    if (searchTerm) {
      matchStage.$or = [
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];
    }

    // -----------------------------
    // 2. CSV HEADERS
    // -----------------------------
    const headers = [
      "Transaction ID",
      "Product Code",
      "Product Name",
      "Date & Time",
      "Transaction Type",
      "Transaction For",
      "Stock Type",
      "Base Point",
      "Quantity",
      "Total Points",
      "Distributor Name",
      "Distributor Code",
      "Description",
    ];

    // -----------------------------
    // 3. FILE NAME
    // -----------------------------
    let fileNameBase = "transaction-report";

    if (!distributorId || distributorId === "all") {
      fileNameBase += "-all-distributors";
    } else if (String(distributorId).includes(",")) {
      fileNameBase += "-selected-distributors";
    } else {
      fileNameBase += `-distributor-${distributorId}`;
    }

    const fileName = `${fileNameBase}-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // -----------------------------
    // 4. CREATE CSV STREAM
    // -----------------------------
    const csvStream = format({ headers });
    csvStream.pipe(res);

    // -----------------------------
    // 5. FETCH TRANSACTIONS
    // -----------------------------
    const transactions = await Transaction.find(matchStage)
      .populate({
        path: "productId",
        select: "product_code name base_point",
      })
      .populate({
        path: "invItemId",
      })
      .populate({
        path: "distributorId",
        select: "name dbCode",
      })
      .sort({ createdAt: -1 });

    // -----------------------------
    // 6. WRITE EACH ROW TO CSV
    // -----------------------------
    transactions.forEach((t) => {
      const basePoint = parseFloat(t.productId?.base_point || 0);
      const quantity = t.qty || 0;
      const totalPoints = basePoint * quantity;

      csvStream.write({
        "Transaction ID": t.transactionId || "",
        "Product Code": t.productId?.product_code || "",
        "Product Name": t.productId?.name || "",
        "Date & Time": t.date
          ? moment(t.date).tz("Asia/Kolkata").format("DD-MM-YYYY hh:mm:ss A")
          : "",
        "Transaction Type": t.type || "",
        "Transaction For": t.transactionType || "",
        "Stock Type": t.stockType || "",
        "Base Point": t.productId?.base_point || 0,
        Quantity: quantity,
        "Total Points": t.type === "In" ? totalPoints : -totalPoints,
        "Distributor Name": t.distributorId?.name || "N/A",
        "Distributor Code": t.distributorId?.dbCode || "N/A",
        Description: t.description || "",
      });
    });

    // -----------------------------
    // 7. END CSV STREAM
    // -----------------------------
    csvStream.end();
  } catch (error) {
    console.error("Transaction Report Error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to generate transaction report",
      error: error.message,
    });
  }
});

module.exports = { viewAllTransactionReport };
