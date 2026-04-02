const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");

const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const Bill = require("../../models/bill.model");
const Invoice = require("../../models/invoice.model");

const downloadRetailerLedgerReport = asyncHandler(async (req, res) => {
  try {
    let {
      retailerId,
      retailerIds,
      distributorId,
      fromDate,
      toDate,
      startDate,
      endDate,
      search,
      transactionType,
      transactionFor,
      status,
      outletCode,
      retailerPhone,
    } = req.query;

    const actualFromDate = fromDate || startDate;
    const actualToDate = toDate || endDate;

    if (!actualFromDate || !actualToDate) {
      return res.status(400).json({ message: "Missing fromDate / toDate" });
    }

    const startOfDay = moment
      .tz(actualFromDate, "Asia/Kolkata")
      .startOf("day")
      .toDate();

    const endOfDay = moment
      .tz(actualToDate, "Asia/Kolkata")
      .endOf("day")
      .toDate();

    /* ---------------- TRANSACTION FILTER ---------------- */
    const filter = { createdAt: { $gte: startOfDay, $lte: endOfDay } };

    if (retailerId) filter.retailerId = retailerId;
    if (distributorId) filter.distributorId = distributorId;
    if (status) filter.status = status;
    if (transactionType) filter.transactionType = transactionType;
    if (transactionFor) filter.transactionFor = transactionFor;

    /* ---------------- SEARCH ---------------- */
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [{ transactionId: regex }, { remark: regex }];

      const bill = await Bill.findOne({ billNo: regex }).select("_id");
      if (bill) filter.$or.push({ billId: bill._id });

      const invoice = await Invoice.findOne({ invoiceNo: regex }).select("_id");
      if (invoice) filter.$or.push({ invoiceId: invoice._id });
    }

    /* ---------------- OUTLET FILTER ---------------- */
    if (retailerPhone || outletCode) {
      const outletQuery = {};
      if (retailerPhone)
        outletQuery.mobile1 = { $regex: retailerPhone.replace(/\D/g, "") };
      if (outletCode) outletQuery.outletCode = outletCode;

      const outletIds = await OutletApproved.find(outletQuery).distinct("_id");
      if (!outletIds.length) return res.end();

      filter.retailerId = { $in: outletIds };
    }

    /* ---------------- RESOLVE RETAILERS ---------------- */
    let retailerObjectIds = [];
    let isAllRetailers = false;

    if (retailerId) {
      retailerObjectIds = [retailerId];
    } else if (retailerIds && retailerIds !== "all") {
      retailerObjectIds = retailerIds.split(",").map((id) => id.trim());
    } else {
      isAllRetailers = true;
      // Get ALL retailers who have EVER had any transaction
      retailerObjectIds =
        await RetailerOutletTransaction.distinct("retailerId");
    }

    if (!retailerObjectIds.length) return res.end();

    /* ---------------- BATCH FETCH OPENING BALANCES ---------------- */
    const openingBalances = await RetailerOutletTransaction.aggregate([
      {
        $match: {
          retailerId: { $in: retailerObjectIds },
          createdAt: { $lt: startOfDay },
          status: "Success",
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$retailerId",
          lastTxn: { $first: "$$ROOT" },
        },
      },
      {
        $lookup: {
          from: "distributors",
          localField: "lastTxn.distributorId",
          foreignField: "_id",
          as: "distributor",
        },
      },
      {
        $project: {
          retailerId: "$_id",
          balance: "$lastTxn.balance",
          distributorId: { $arrayElemAt: ["$distributor", 0] },
        },
      },
    ]);

    const openingBalanceMap = new Map();
    openingBalances.forEach((item) => {
      openingBalanceMap.set(item.retailerId.toString(), {
        balance: Number(item.balance) || 0,
        distributorId: item.distributorId,
      });
    });

    /* ---------------- BATCH FETCH ALL TRANSACTIONS ---------------- */
    const allTxns = await RetailerOutletTransaction.find({
      ...filter,
      retailerId: { $in: retailerObjectIds },
    })
      .populate({ path: "distributorId", select: "name dbCode" })
      .sort({ retailerId: 1, createdAt: 1 })
      .lean();

    // Group transactions by retailer
    const txnsByRetailer = new Map();
    allTxns.forEach((txn) => {
      const key = txn.retailerId.toString();
      if (!txnsByRetailer.has(key)) {
        txnsByRetailer.set(key, []);
      }
      txnsByRetailer.get(key).push(txn);
    });

    /* ---------------- CSV SETUP ---------------- */
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=retailer-ledger-dms-${moment().format(
        "YYYY-MM-DD-HH-mm-ss",
      )}.csv`,
    );

    const csvStream = format({
      headers: [
        "Date",
        "Retailer code",
        "Retailer uid",
        "Retailer name",
        "Retailer state",
        "Retailer city",
        "DB Name",
        "DB Code",
        "Opening balance",
        "Opening Point Credit",
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
      ],
    });

    csvStream.pipe(res);

    /* ---------------- ROUTE TO APPROPRIATE METHOD ---------------- */
    if (isAllRetailers) {
      // ⭐ OPTIMIZED BATCH PROCESSING FOR ALL RETAILERS
      await processAllRetailersOptimized(
        retailerObjectIds,
        filter,
        startOfDay,
        endOfDay,
        csvStream,
      );
    } else {
      // ⭐ STANDARD PROCESSING FOR SINGLE/SPECIFIC RETAILERS
      await processSingleRetailers(
        retailerObjectIds,
        filter,
        startOfDay,
        endOfDay,
        csvStream,
      );
    }

    csvStream.end();
  } catch (err) {
    console.error("Retailer Ledger Error:", err);
    console.error("Error Stack:", err.stack);

    if (res.headersSent) {
      return res.end();
    }

    res.status(500).json({
      message: "Failed to generate retailer ledger report",
      error: err.message,
    });
  }
});

/* ---------------- STANDARD PROCESSING (FOR SINGLE/SPECIFIC RETAILERS) ---------------- */
async function processSingleRetailers(
  retailerObjectIds,
  filter,
  startOfDay,
  endOfDay,
  csvStream,
) {
  const retailerCursor = OutletApproved.find({
    _id: { $in: retailerObjectIds },
  })
    .populate([
      { path: "stateId", select: "name" },
      { 
        path: "beatId", 
        select: "name code distributorId",
        populate: { path: "distributorId", select: "name dbCode" }
      },
    ])
    .lean()
    .cursor();

  for await (const retailer of retailerCursor) {
    // Get transactions in the selected date range
    const txns = await RetailerOutletTransaction.find({
      ...filter,
      retailerId: retailer._id,
    })
      .populate({ path: "distributorId", select: "name dbCode" })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    // ⭐ Get opening balance (balance BEFORE the date range starts)
    const openingTxn = await RetailerOutletTransaction.findOne({
      retailerId: retailer._id,
      createdAt: { $lt: startOfDay },
      status: "Success",
    })
      .sort({ createdAt: -1, _id: -1 })
      .populate({ path: "distributorId", select: "name dbCode" })
      .lean();

    const openingBalance = openingTxn ? Number(openingTxn.balance) : 0;

    // ⭐ Get closing balance (LATEST/CURRENT balance)
    const latestTxn = await RetailerOutletTransaction.findOne({
      retailerId: retailer._id,
      status: "Success",
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const closingBalance = latestTxn ? Number(latestTxn.balance) : 0;

    let runningBalance = openingBalance;

    // Skip retailer if no activity
    const hasAnyActivity =
      txns.length > 0 || openingBalance > 0 || closingBalance > 0;
    if (!hasAnyActivity) {
      continue;
    }

    /* ---------- GROUP BY DATE ---------- */
    const txnsByDate = {};
    for (const t of txns) {
      const key = moment(t.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD");
      (txnsByDate[key] ||= []).push(t);
    }

    const current = moment.tz(startOfDay, "Asia/Kolkata");
    const end = moment.tz(endOfDay, "Asia/Kolkata");

    while (current.isSameOrBefore(end, "day")) {
      const dayKey = current.format("YYYY-MM-DD");
      const dayTxns = txnsByDate[dayKey] || [];

      let openingCredit = 0,
        salesCredit = 0,
        multiplierCredit = 0,
        redemptionCancelCredit = 0,
        manualCredit = 0,
        salesReturnDebit = 0,
        salesReturnMultiplierDebit = 0,
        giftRedemptionDebit = 0,
        manualDebit = 0;

      /* ---------- TRANSACTION CLASSIFICATION ---------- */
      for (const t of dayTxns) {
        const p = Number(t.point) || 0;

        switch (t.transactionFor) {
          case "Opening Points":
            openingCredit += p;
            break;

          case "SALES":
            salesCredit += p;
            break;

          case "Sales Multiplier":
          case "Volume Multiplier":
          case "Consistency Multiplier":
          case "Bill Volume Multiplier":
            multiplierCredit += p;
            break;

          case "Gift Order Cancellation":
            redemptionCancelCredit += p;
            break;

          case "Manual Point":
            t.transactionType === "credit"
              ? (manualCredit += p)
              : (manualDebit += p);
            break;

          case "Sales Return":
            salesReturnDebit += p;
            break;

          case "Multiplier Sales Return":
            salesReturnMultiplierDebit += p;
            break;

          case "Gift Redemption":
            giftRedemptionDebit += p;
            break;

          default:
            break;
        }
      }

      const dayOpeningBalance = runningBalance;
      const dayClosingBalance =
        dayTxns.length > 0
          ? Number(dayTxns[dayTxns.length - 1].balance)
          : runningBalance;

      runningBalance = dayClosingBalance;

      // Get distributor with full details (name, dbCode)
      // Priority: 1) Transaction distributor, 2) Opening transaction distributor, 3) Retailer's beat distributor
      let distributor = null;
      if (dayTxns[0]?.distributorId) {
        distributor = dayTxns[0].distributorId;
      } else if (openingTxn?.distributorId) {
        distributor = openingTxn.distributorId;
      } else {
        // Get distributor from retailer's beat
        const beats = Array.isArray(retailer.beatId) ? retailer.beatId : [retailer.beatId];
        for (const beat of beats) {
          if (Array.isArray(beat?.distributorId) && beat.distributorId.length > 0) {
            distributor = beat.distributorId[0];
            break;
          } else if (beat?.distributorId) {
            distributor = beat.distributorId;
            break;
          }
        }
      }

      const dayTotalPoints =
        openingCredit +
        salesCredit +
        multiplierCredit +
        redemptionCancelCredit +
        manualCredit -
        (salesReturnDebit +
          salesReturnMultiplierDebit +
          giftRedemptionDebit +
          manualDebit);

      /* ---------- SKIP PURE ZERO DAYS ---------- */
      if (
        dayTxns.length === 0 &&
        dayOpeningBalance === 0 &&
        dayClosingBalance === 0
      ) {
        current.add(1, "day");
        continue;
      }

      const formatNumber = (val, fallback = 0) =>
        val != null
          ? Number.isInteger(val)
            ? val
            : Number(val).toFixed(2)
          : fallback;

      // csvStream.write({
      //   Date: current.format("DD-MM-YYYY"),
      //   "Retailer code": retailer.outletCode || "",
      //   "Retailer uid": retailer.outletUID || "",
      //   "Retailer name": retailer.outletName || "",
      //   "Retailer state": retailer.stateId?.name || "",
      //   "Retailer city": retailer.city || "",
      //   "DB Name": distributor?.name || "",
      //   "DB Code": distributor?.dbCode || "",
      //   "Opening balance": dayOpeningBalance, // ✅ FIXED: Daily opening = previous day's closing
      //   "Opening Point Credit": openingCredit,
      //   "Sales Point Credit": salesCredit,
      //   "Multiplier Point Credit": multiplierCredit,
      //   "Redemption Cancellation Point Credit": redemptionCancelCredit,
      //   "Manual Adjustment Point Credit": manualCredit,
      //   "Sales Return Point Debit": salesReturnDebit,
      //   "Sales Return Multiplier Point Debit": salesReturnMultiplierDebit,
      //   "Gift Redemption Point Debit": giftRedemptionDebit,
      //   "Manual Adjustment Point Debit": manualDebit,
      //   "Day Total Points": dayTotalPoints,
      //   "Closing balance": dayClosingBalance, // ✅ This becomes next day's opening
      // });
      csvStream.write({
        Date: current.format("DD-MM-YYYY"),
        "Retailer code": retailer.outletCode || "",
        "Retailer uid": retailer.outletUID || "",
        "Retailer name": retailer.outletName || "",
        "Retailer state": retailer.stateId?.name || "",
        "Retailer city": retailer.city || "",
        "DB Name": distributor?.name || "",
        "DB Code": distributor?.dbCode || "",

        "Opening balance": formatNumber(dayOpeningBalance),
        "Opening Point Credit": formatNumber(openingCredit),
        "Sales Point Credit": formatNumber(salesCredit),
        "Multiplier Point Credit": formatNumber(multiplierCredit),
        "Redemption Cancellation Point Credit": formatNumber(
          redemptionCancelCredit,
        ),
        "Manual Adjustment Point Credit": formatNumber(manualCredit),

        "Sales Return Point Debit": formatNumber(salesReturnDebit),
        "Sales Return Multiplier Point Debit": formatNumber(
          salesReturnMultiplierDebit,
        ),
        "Gift Redemption Point Debit": formatNumber(giftRedemptionDebit),
        "Manual Adjustment Point Debit": formatNumber(manualDebit),

        "Day Total Points": formatNumber(dayTotalPoints),
        "Closing balance": formatNumber(dayClosingBalance),
      });

      current.add(1, "day");
    }
  }
}

/* ---------------- OPTIMIZED BATCH PROCESSING (FOR ALL RETAILERS) ---------------- */
async function processAllRetailersOptimized(
  retailerObjectIds,
  filter,
  startOfDay,
  endOfDay,
  csvStream,
) {
  // 1. Fetch all retailers in one query
  const retailers = await OutletApproved.find({
    _id: { $in: retailerObjectIds },
  })
    .populate([
      { path: "stateId", select: "name" },
      { 
        path: "beatId", 
        select: "name code distributorId",
        populate: { path: "distributorId", select: "name dbCode" }
      },
    ])
    .lean();

  const retailerMap = new Map(retailers.map((r) => [r._id.toString(), r]));

  // 2. Fetch all transactions in date range in ONE query
  const allTransactions = await RetailerOutletTransaction.find({
    ...filter,
    retailerId: { $in: retailerObjectIds },
  })
    .populate({ path: "distributorId", select: "name dbCode" })
    .sort({ retailerId: 1, createdAt: 1, _id: 1 })
    .lean();

  // 3. Fetch opening balances (before date range) in ONE aggregation
  const openingBalances = await RetailerOutletTransaction.aggregate([
    {
      $match: {
        retailerId: { $in: retailerObjectIds },
        createdAt: { $lt: startOfDay },
        status: "Success",
      },
    },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$retailerId",
        lastTransaction: { $first: "$$ROOT" },
      },
    },
    {
      $lookup: {
        from: "distributors",
        localField: "lastTransaction.distributorId",
        foreignField: "_id",
        as: "distributor",
      },
    },
    {
      $project: {
        retailerId: "$_id",
        balance: "$lastTransaction.balance",
        distributorId: { $arrayElemAt: ["$distributor", 0] },
      },
    },
  ]);

  // 4. Fetch latest balances (current) in ONE aggregation
  const latestBalances = await RetailerOutletTransaction.aggregate([
    {
      $match: {
        retailerId: { $in: retailerObjectIds },
        status: "Success",
      },
    },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$retailerId",
        latestBalance: { $first: "$balance" },
      },
    },
  ]);

  // Create lookup maps
  const openingBalanceMap = new Map(
    openingBalances.map((ob) => [ob.retailerId.toString(), ob]),
  );

  const latestBalanceMap = new Map(
    latestBalances.map((lb) => [lb._id.toString(), lb.latestBalance]),
  );

  // Group transactions by retailerId
  const txnsByRetailer = new Map();
  for (const txn of allTransactions) {
    const key = txn.retailerId.toString();
    if (!txnsByRetailer.has(key)) {
      txnsByRetailer.set(key, []);
    }
    txnsByRetailer.get(key).push(txn);
  }

  /* ---------------- PROCESS EACH RETAILER (NO DB QUERIES IN LOOP) ---------------- */
  for (const retailerId of retailerObjectIds) {
    const retailerIdStr = retailerId.toString();
    const retailer = retailerMap.get(retailerIdStr);

    if (!retailer) continue;

    const txns = txnsByRetailer.get(retailerIdStr) || [];
    const openingData = openingBalanceMap.get(retailerIdStr);
    const openingBalance = openingData ? Number(openingData.balance) : 0;
    const closingBalance = latestBalanceMap.get(retailerIdStr) || 0;

    let runningBalance = openingBalance;

    // Skip retailer if no activity
    const hasAnyActivity =
      txns.length > 0 || openingBalance > 0 || closingBalance > 0;
    if (!hasAnyActivity) {
      continue;
    }

    /* ---------- GROUP BY DATE ---------- */
    const txnsByDate = {};
    for (const t of txns) {
      const key = moment(t.createdAt).tz("Asia/Kolkata").format("YYYY-MM-DD");
      (txnsByDate[key] ||= []).push(t);
    }

    const current = moment.tz(startOfDay, "Asia/Kolkata");
    const end = moment.tz(endOfDay, "Asia/Kolkata");

    while (current.isSameOrBefore(end, "day")) {
      const dayKey = current.format("YYYY-MM-DD");
      const dayTxns = txnsByDate[dayKey] || [];

      let openingCredit = 0,
        salesCredit = 0,
        multiplierCredit = 0,
        redemptionCancelCredit = 0,
        manualCredit = 0,
        salesReturnDebit = 0,
        salesReturnMultiplierDebit = 0,
        giftRedemptionDebit = 0,
        manualDebit = 0;

      /* ---------- TRANSACTION CLASSIFICATION ---------- */
      for (const t of dayTxns) {
        const p = Number(t.point) || 0;

        switch (t.transactionFor) {
          case "Opening Points":
            openingCredit += p;
            break;

          case "SALES":
            salesCredit += p;
            break;

          case "Sales Multiplier":
          case "Volume Multiplier":
          case "Consistency Multiplier":
          case "Bill Volume Multiplier":
            multiplierCredit += p;
            break;

          case "Gift Order Cancellation":
            redemptionCancelCredit += p;
            break;

          case "Manual Point":
            t.transactionType === "credit"
              ? (manualCredit += p)
              : (manualDebit += p);
            break;

          case "Sales Return":
            salesReturnDebit += p;
            break;

          case "Multiplier Sales Return":
            salesReturnMultiplierDebit += p;
            break;

          case "Gift Redemption":
            giftRedemptionDebit += p;
            break;

          default:
            break;
        }
      }

      const dayOpeningBalance = runningBalance;
      const dayClosingBalance =
        dayTxns.length > 0
          ? Number(dayTxns[dayTxns.length - 1].balance)
          : runningBalance;

      runningBalance = dayClosingBalance;

      // Get distributor with full details (name, dbCode)
      // Priority: 1) Transaction distributor, 2) Opening transaction distributor, 3) Retailer's beat distributor
      let distributor = null;
      if (dayTxns[0]?.distributorId) {
        distributor = dayTxns[0].distributorId;
      } else if (openingData?.distributorId) {
        distributor = openingData.distributorId;
      } else {
        // Get distributor from retailer's beat
        const beats = Array.isArray(retailer.beatId) ? retailer.beatId : [retailer.beatId];
        for (const beat of beats) {
          if (Array.isArray(beat?.distributorId) && beat.distributorId.length > 0) {
            distributor = beat.distributorId[0];
            break;
          } else if (beat?.distributorId) {
            distributor = beat.distributorId;
            break;
          }
        }
      }

      const dayTotalPoints =
        openingCredit +
        salesCredit +
        multiplierCredit +
        redemptionCancelCredit +
        manualCredit -
        (salesReturnDebit +
          salesReturnMultiplierDebit +
          giftRedemptionDebit +
          manualDebit);

      /* ---------- SKIP PURE ZERO DAYS ---------- */
      if (
        dayTxns.length === 0 &&
        dayOpeningBalance === 0 &&
        dayClosingBalance === 0
      ) {
        current.add(1, "day");
        continue;
      }

      csvStream.write({
        Date: current.format("DD-MM-YYYY"),
        "Retailer code": retailer.outletCode || "",
        "Retailer uid": retailer.outletUID || "",
        "Retailer name": retailer.outletName || "",
        "Retailer state": retailer.stateId?.name || "",
        "Retailer city": retailer.city || "",
        "DB Name": distributor?.name || "",
        "DB Code": distributor?.dbCode || "",
        "Opening balance": dayOpeningBalance, // ✅ FIXED: Daily opening = previous day's closing
        "Opening Point Credit": openingCredit,
        "Sales Point Credit": salesCredit,
        "Multiplier Point Credit": multiplierCredit,
        "Redemption Cancellation Point Credit": redemptionCancelCredit,
        "Manual Adjustment Point Credit": manualCredit,
        "Sales Return Point Debit": salesReturnDebit,
        "Sales Return Multiplier Point Debit": salesReturnMultiplierDebit,
        "Gift Redemption Point Debit": giftRedemptionDebit,
        "Manual Adjustment Point Debit": manualDebit,
        "Day Total Points": dayTotalPoints,
        "Closing balance": dayClosingBalance, // ✅ This becomes next day's opening
      });

      current.add(1, "day");
    }
  }
}

module.exports = { downloadRetailerLedgerReport };
