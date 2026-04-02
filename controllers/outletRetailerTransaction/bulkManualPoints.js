const asyncHandler = require("express-async-handler");
const csv = require("csv-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const { retailerOutletTransactionCode } = require("../../utils/codeGenerator");

/* -------------------- CONSTANTS -------------------- */
const ALLOWED_TRANSACTION_FOR = new Set([
  "SALES",
  "Volume Multiplier",
  "Consistency Multiplier",
  "Bill Volume Multiplier",
  "Sales Return",
  "Opening Points",
  "Manual Point",
]);

/* -------------------- CONTROLLER -------------------- */
const bulkManualPointsUpload = asyncHandler(async (req, res) => {
  const { secure_url, url, csvUrl } = req.body;
  const fileUrl = secure_url || url || csvUrl;

  if (!fileUrl) {
    return res.status(400).json({ message: "CSV URL is required" });
  }

  const tempFilePath = path.join(__dirname, `${uuidv4()}.csv`);

  const rows = [];
  const failedRows = [];
  const transactions = [];
  const balanceTracker = new Map();

  try {
    /* ---------- DOWNLOAD CSV ---------- */
    const response = await axios.get(fileUrl, {
      responseType: "stream",
      timeout: 60000,
    });

    response.data.pipe(fs.createWriteStream(tempFilePath));
    await new Promise(resolve => response.data.on("end", resolve));

    /* ---------- PARSE CSV ---------- */
    await new Promise((resolve, reject) => {
      fs.createReadStream(tempFilePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) =>
              header?.replace(/^\uFEFF/, "").trim(),
          })
        )
        .on("data", row => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    if (!rows.length) {
      return res.status(400).json({
        message: "CSV contains no data rows",
        summary: { successCount: 0, skippedCount: 0 },
        skippedData: [],
      });
    }

    /* ---------- FETCH OUTLETS ---------- */
    const outletUIDs = [
      ...new Set(rows.map(r => r["Retailer UID"]?.trim()).filter(Boolean)),
    ];

    const outlets = await OutletApproved.find(
      { outletUID: { $in: outletUIDs } },
      {
        outletUID: 1,
        outletName: 1,
        currentPointBalance: 1,
        distributorId: 1,
      }
    );

    const outletMap = new Map();
    outlets.forEach(o => outletMap.set(o.outletUID, o));

    /* ---------- VALIDATION & PREP ---------- */
    for (const row of rows) {
      try {
        const outletUID = row["Retailer UID"]?.trim();
        const outletName = row["Retailer Name"]?.trim();
        const typeRaw = row["Transaction Type"]?.trim();
        const transactionForRaw = row["Transaction For"]?.trim();
        const points = Number(row["Point"]);
        const transactionDateRaw = row["Transaction Date"]?.trim();

        if (!outletUID) throw new Error("Retailer UID missing");
        if (!outletName) throw new Error("Retailer Name missing");
        if (!typeRaw) throw new Error("Transaction Type missing");
        if (!transactionForRaw) throw new Error("Transaction For missing");
        if (!transactionDateRaw) throw new Error("Transaction Date missing");

        const transactionDate = new Date(`${transactionDateRaw}T00:00:00.000Z`);
        if (isNaN(transactionDate)) {
          throw new Error("Invalid date format (YYYY-MM-DD)");
        }

        const transactionType = typeRaw.toLowerCase();
        if (!["credit", "debit"].includes(transactionType)) {
          throw new Error("Transaction Type must be Credit or Debit");
        }

        if (isNaN(points) || points <= 0) {
          throw new Error("Point must be > 0");
        }

        if (!ALLOWED_TRANSACTION_FOR.has(transactionForRaw)) {
          throw new Error(`Invalid Transaction For: ${transactionForRaw}`);
        }

        const outlet = outletMap.get(outletUID);
        if (!outlet) throw new Error("Retailer UID not found");

        if (outlet.outletName !== outletName) {
          throw new Error("Retailer Name mismatch");
        }

        const lastBalance =
          balanceTracker.get(outletUID) ??
          outlet.currentPointBalance ??
          0;

        if (transactionType === "debit" && lastBalance < points) {
          throw new Error("Insufficient balance");
        }

        const newBalance =
          transactionType === "debit"
            ? lastBalance - points
            : lastBalance + points;

        balanceTracker.set(outletUID, newBalance);

        transactions.push({
          retailerId: outlet._id,
          transactionId: await retailerOutletTransactionCode("RTO"),
          transactionType,
          transactionFor: transactionForRaw,
          point: points,
          balance: newBalance,
          distributorId: outlet.distributorId || null,
          status: "Success",
          remark: row["Remark"] || "Manual points upload",
          createdAt: transactionDate,
          updatedAt: transactionDate,
        });
      } catch (err) {
        failedRows.push({ ...row, "Error Reason": err.message });
      }
    }

    if (!transactions.length) {
      return res.status(200).json({
        message: "All rows failed validation",
        summary: { successCount: 0, skippedCount: failedRows.length },
        skippedData: failedRows,
      });
    }

    /* ---------- UPDATE OUTLET BALANCES ---------- */
    for (const [uid, balance] of balanceTracker) {
      await OutletApproved.updateOne(
        { _id: outletMap.get(uid)._id },
        {
          $set: {
            currentPointBalance: balance,
            // isFirstOpeningPoint: true,
          },
        }
      );
    }

    /* ---------- INSERT TRANSACTIONS ---------- */
    await RetailerOutletTransaction.insertMany(transactions, {
      ordered: true,
    });

    return res.status(200).json({
      message: "Bulk manual points upload completed",
      summary: {
        successCount: transactions.length,
        skippedCount: failedRows.length,
      },
      skippedData: failedRows,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});

module.exports = { bulkManualPointsUpload };
