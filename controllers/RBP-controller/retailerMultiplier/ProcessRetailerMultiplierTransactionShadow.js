const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const axios = require("axios");
const moment = require("moment-timezone");

const RetailerMultiplierTransactionShadow = require("../../../models/retailerMultiplierTransactionShadow.model");
const OutletApproved = require("../../../models/outletApproved.model");
const Bill = require("../../../models/bill.model");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerMultiplierShadowRun = require("../../../models/retailerMultiplierShadowRun.model");

const { SERVER_URL } = require("../../../config/server.config");

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_ITEM_CONCURRENCY = 5;
const STALE_RUN_MINUTES = 15;
const VALID_MULTIPLIER_TYPES = new Set(["all", "monthly", "consistency"]);
const CHECKPOINT_RECORD_TYPE = "checkpoint";
const TRANSACTION_RECORD_TYPE = "transaction";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Build a safe, serialisable summary of a shadow run document.
// ─────────────────────────────────────────────────────────────────────────────
const buildRunSummary = (run) => ({
  runId: run._id,
  status: run.status,
  month: run.month,
  year: run.year,
  multiplierType: run.multiplierType,
  batchSize: run.batchSize,
  totalRetailers: run.totalRetailers,
  pendingRetailers: run.pendingRetailers,
  processingRetailers: run.processingRetailers,
  completedRetailers: run.completedRetailers,
  skippedRetailers: run.skippedRetailers,
  failedRetailers: run.failedRetailers,
  processedRetailers: run.processedRetailers,
  attemptedRetailers: run.attemptedRetailers,
  currentBatchNumber: run.currentBatchNumber,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
  lastHeartbeatAt: run.lastHeartbeatAt,
  lastError: run.lastError,
  canResume: run.status !== "Completed",
});

// ─────────────────────────────────────────────────────────────────────────────
// Input normalisers
// ─────────────────────────────────────────────────────────────────────────────
const normalizeBatchSize = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
};

const normalizeMaxBatches = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeMultiplierType = (value) => {
  if (!value) return "all";
  return String(value).trim().toLowerCase();
};

// ─────────────────────────────────────────────────────────────────────────────
// Consistency: look at the 3 months BEFORE the requested month (not including it).
//
// FIX: $lt → $lte on deliveryDate end boundary so that a bill whose
//      deliveryDate lands on the exact IST end-of-month millisecond
//      (e.g. 2026-02-28T18:29:59.999Z) is correctly included.
// ─────────────────────────────────────────────────────────────────────────────
const getRetailersBillMonthConsistency = async (retailerId, month, year) => {
  try {
    let consistency = 0;

    const baseMoment = moment
      .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
      .startOf("month");

    for (let i = 0; i < 3; i++) {
      const start = baseMoment
        .clone()
        .subtract(i, "months")
        .startOf("month")
        .toDate();

      // FIX: use endOf("month") and $lte so bills delivered at the very last
      // millisecond of the month (IST midnight boundary stored as UTC) are
      // not silently excluded.
      const end = baseMoment
        .clone()
        .subtract(i, "months")
        .endOf("month")
        .toDate();

      const billCount = await Bill.countDocuments({
        retailerId,
        status: "Delivered",
        "dates.deliveryDate": { $gte: start, $lte: end }, // ← was $lt
      });

      if (billCount > 0) {
        consistency++;
      } else {
        break;
      }
    }

    return consistency;
  } catch (error) {
    return 0;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Build the date window for the requested month.
//
// FIX: endDate is kept as endOf("month") (inclusive), and all callers that
//      previously used $lt now use $lte to avoid missing edge-boundary bills.
// Special case: November 2025 window extended to December 3rd (business rule).
// ─────────────────────────────────────────────────────────────────────────────
const getProcessingWindow = (month, year) => {
  const startDate = moment
    .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
    .startOf("day")
    .toDate();

  let endDate;
  if (month === 11 && year === 2025) {
    // Special business rule: November 2025 window extended to December 3rd
    endDate = moment
      .tz({ year: 2025, month: 11, day: 3 }, "Asia/Kolkata")
      .endOf("day")
      .toDate();
  } else {
    endDate = moment
      .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
      .endOf("month")
      .toDate();
  }

  return { startDate, endDate };
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch active reward slabs from the internal API.
// ─────────────────────────────────────────────────────────────────────────────
const fetchRewardSlabs = async () => {
  const { data } = await axios.get(
    `${SERVER_URL}/api/v1/reward-slab/get-reward-slabs`,
  );

  const rewardSlabs = data?.data || [];

  if (!rewardSlabs.length) {
    throw new Error("No reward slabs found.");
  }

  const volumeMultiplierSlab = rewardSlabs.find(
    (slab) => slab.slabType === "Volume Multiplier",
  );
  const consistencyMultiplierSlab = rewardSlabs.find(
    (slab) => slab.slabType === "Consistency Multiplier",
  );
  const billVolumeMultiplierSlab = rewardSlabs.find(
    (slab) => slab.slabType === "Bill Volume Multiplier",
  );

  if (
    !volumeMultiplierSlab &&
    !consistencyMultiplierSlab &&
    !billVolumeMultiplierSlab
  ) {
    throw new Error("No applicable reward slabs found for multipliers.");
  }

  return {
    volumeMultiplierSlab,
    consistencyMultiplierSlab,
    billVolumeMultiplierSlab,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolve the list of retailers from the incoming request body.
// Shadow runs include ALL retailers so the audit is complete — no filtering
// against a previous-month main-table entry.
// ─────────────────────────────────────────────────────────────────────────────
const resolveRetailersFromRequest = async ({
  retailerId,
  retailerIds,
  allRetailers,
}) => {
  let selectionType = null;
  let requestedRetailerIds = [];
  let retailerList = [];

  if (allRetailers) {
    selectionType = "all";
    retailerList = await OutletApproved.find({})
      .select("_id outletName outletCode outletUID")
      .sort({ _id: 1 })
      .lean();
  } else if (Array.isArray(retailerIds) && retailerIds.length > 0) {
    selectionType = "multiple";
    requestedRetailerIds = [...new Set(retailerIds.map(String))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    retailerList = await OutletApproved.find({
      _id: { $in: requestedRetailerIds },
    })
      .select("_id outletName outletCode outletUID")
      .sort({ _id: 1 })
      .lean();
  } else if (retailerId) {
    selectionType = "single";
    if (!mongoose.Types.ObjectId.isValid(String(retailerId))) {
      throw new Error("Invalid retailerId.");
    }
    const retailer = await OutletApproved.findById(retailerId)
      .select("_id outletName outletCode outletUID")
      .lean();
    if (!retailer) {
      throw new Error("Retailer not found.");
    }
    retailerList = [retailer];
    requestedRetailerIds = [String(retailer._id)];
  }

  if (!selectionType) {
    throw new Error(
      "Missing required fields: month, year, and retailer selection",
    );
  }

  if (!retailerList.length) {
    throw new Error("No retailers found for processing.");
  }

  if (selectionType !== "all") {
    requestedRetailerIds = retailerList.map((r) => String(r._id));
  }

  return {
    selectionType,
    requestedRetailerIds: requestedRetailerIds.sort(),
    retailerList,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Build a deterministic signature for the run so we can detect & reuse an
// identical in-flight or incomplete run instead of creating duplicates.
// ─────────────────────────────────────────────────────────────────────────────
const buildRequestSignature = ({
  month,
  year,
  multiplierType,
  selectionType,
  requestedRetailerIds,
}) =>
  [
    year,
    month,
    multiplierType,
    selectionType,
    selectionType === "all" ? "all" : requestedRetailerIds.join(","),
  ].join("|");

// ─────────────────────────────────────────────────────────────────────────────
// Re-count checkpoint documents and sync the run's progress counters.
// ─────────────────────────────────────────────────────────────────────────────
const refreshShadowRunProgress = async (runId, extraFields = {}) => {
  const [
    run,
    pendingRetailers,
    processingRetailers,
    completedRetailers,
    failedRetailers,
    skippedRetailers,
  ] = await Promise.all([
    RetailerMultiplierShadowRun.findById(runId).lean(),
    RetailerMultiplierTransactionShadow.countDocuments({
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Pending",
    }),
    RetailerMultiplierTransactionShadow.countDocuments({
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Processing",
    }),
    RetailerMultiplierTransactionShadow.countDocuments({
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Completed",
    }),
    RetailerMultiplierTransactionShadow.countDocuments({
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Failed",
    }),
    RetailerMultiplierTransactionShadow.countDocuments({
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Skipped",
    }),
  ]);

  if (!run) return null;

  const processedRetailers = completedRetailers + skippedRetailers;
  const attemptedRetailers = processedRetailers + failedRetailers;

  let status = run.status;
  if (processingRetailers > 0) {
    status = "Running";
  } else if (pendingRetailers === 0 && failedRetailers === 0) {
    status = "Completed";
  } else {
    status = "Incomplete";
  }

  return RetailerMultiplierShadowRun.findByIdAndUpdate(
    runId,
    {
      $set: {
        pendingRetailers,
        processingRetailers,
        completedRetailers,
        failedRetailers,
        skippedRetailers,
        processedRetailers,
        attemptedRetailers,
        status,
        completedAt: status === "Completed" ? new Date() : null,
        ...extraFields,
      },
    },
    { new: true },
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Any checkpoint that has been stuck in "Processing" for longer than
// STALE_RUN_MINUTES is reset to "Pending" so it can be retried.
// ─────────────────────────────────────────────────────────────────────────────
const markStaleProcessingItemsPending = async (runId) => {
  const staleThreshold = moment()
    .tz("Asia/Kolkata")
    .subtract(STALE_RUN_MINUTES, "minutes")
    .toDate();

  await RetailerMultiplierTransactionShadow.updateMany(
    {
      shadowMultiplierRunId: runId,
      recordType: CHECKPOINT_RECORD_TYPE,
      runItemStatus: "Processing",
      processingStartedAt: { $lte: staleThreshold },
    },
    {
      $set: { runItemStatus: "Pending" },
      $unset: { processingStartedAt: "", lastError: "" },
    },
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Atomically transition a run into "Running" state (handles stale-heartbeat
// takeover). Returns null if another worker already owns the run.
// ─────────────────────────────────────────────────────────────────────────────
const acquireRunForProcessing = async (runId) => {
  const staleThreshold = moment()
    .tz("Asia/Kolkata")
    .subtract(STALE_RUN_MINUTES, "minutes")
    .toDate();

  let run = await RetailerMultiplierShadowRun.findOneAndUpdate(
    {
      _id: runId,
      $or: [
        { status: { $in: ["Pending", "Incomplete"] } },
        {
          status: "Running",
          $or: [
            { lastHeartbeatAt: { $exists: false } },
            { lastHeartbeatAt: null },
            { lastHeartbeatAt: { $lte: staleThreshold } },
          ],
        },
      ],
    },
    {
      $set: {
        status: "Running",
        lastHeartbeatAt: new Date(),
        lastError: null,
      },
    },
    { new: true },
  );

  if (!run) return null;

  if (!run.startedAt) {
    run = await RetailerMultiplierShadowRun.findByIdAndUpdate(
      runId,
      { $set: { startedAt: new Date() } },
      { new: true },
    );
  }

  return run;
};

// ─────────────────────────────────────────────────────────────────────────────
// Create a brand-new run or reuse an existing Pending/Running/Incomplete run
// with the same request signature.
// ─────────────────────────────────────────────────────────────────────────────
const createOrReuseShadowRun = async ({
  month,
  year,
  multiplierType,
  batchSize,
  selectionType,
  requestedRetailerIds,
  retailerList,
}) => {
  const requestSignature = buildRequestSignature({
    month,
    year,
    multiplierType,
    selectionType,
    requestedRetailerIds,
  });

  const existingRun = await RetailerMultiplierShadowRun.findOne({
    requestSignature,
    status: { $in: ["Pending", "Running", "Incomplete"] },
  }).sort({ createdAt: -1 });

  if (existingRun) {
    // Ensure checkpoint documents exist (they may be missing if the run was
    // created but the insert failed mid-flight).
    const checkpointCount =
      await RetailerMultiplierTransactionShadow.countDocuments({
        shadowMultiplierRunId: existingRun._id,
        recordType: CHECKPOINT_RECORD_TYPE,
      });

    if (!checkpointCount) {
      await RetailerMultiplierTransactionShadow.insertMany(
        retailerList.map((retailer) => ({
          recordType: CHECKPOINT_RECORD_TYPE,
          retailerId: retailer._id,
          retailerCode: retailer.outletCode || "",
          retailerName: retailer.outletName || "",
          month: Number(month),
          year: Number(year),
          status: "Pending",
          shadowMultiplierRunId: existingRun._id,
          shadowRunId: `${existingRun._id}_${retailer._id}`,
          runItemStatus: "Pending",
          attempts: 0,
          transactionsGenerated: 0,
        })),
      );
    }

    // If the run is genuinely being worked on by another process, bail out.
    const isFreshlyRunning =
      existingRun.status === "Running" &&
      existingRun.lastHeartbeatAt &&
      moment(existingRun.lastHeartbeatAt).isAfter(
        moment().tz("Asia/Kolkata").subtract(STALE_RUN_MINUTES, "minutes"),
      );

    if (isFreshlyRunning) {
      return {
        run: existingRun,
        createdNewRun: false,
        resumedExistingRun: true,
        alreadyRunning: true,
      };
    }

    // Update batchSize if the caller supplied a different value.
    if (existingRun.batchSize !== batchSize) {
      const updatedRun = await RetailerMultiplierShadowRun.findByIdAndUpdate(
        existingRun._id,
        { $set: { batchSize } },
        { new: true },
      );
      return {
        run: updatedRun,
        createdNewRun: false,
        resumedExistingRun: true,
        alreadyRunning: false,
      };
    }

    return {
      run: existingRun,
      createdNewRun: false,
      resumedExistingRun: true,
      alreadyRunning: false,
    };
  }

  // ── Create a fresh run ──────────────────────────────────────────────────
  const run = await RetailerMultiplierShadowRun.create({
    month,
    year,
    selectionType,
    requestedRetailerIds:
      selectionType === "all"
        ? []
        : requestedRetailerIds.map((id) => new mongoose.Types.ObjectId(id)),
    requestedRetailerCount: retailerList.length,
    requestSignature,
    multiplierType,
    batchSize,
    totalRetailers: retailerList.length,
    pendingRetailers: retailerList.length,
  });

  await RetailerMultiplierTransactionShadow.insertMany(
    retailerList.map((retailer) => ({
      recordType: CHECKPOINT_RECORD_TYPE,
      retailerId: retailer._id,
      retailerCode: retailer.outletCode || "",
      retailerName: retailer.outletName || "",
      month: Number(month),
      year: Number(year),
      status: "Pending",
      shadowMultiplierRunId: run._id,
      shadowRunId: `${run._id}_${retailer._id}`,
      runItemStatus: "Pending",
      attempts: 0,
      transactionsGenerated: 0,
    })),
  );

  const refreshedRun = await refreshShadowRunProgress(run._id, {
    batchSize,
    lastHeartbeatAt: null,
  });

  return {
    run: refreshedRun,
    createdNewRun: true,
    resumedExistingRun: false,
    alreadyRunning: false,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Claim the next batch of Pending/Failed checkpoints and mark them Processing.
// ─────────────────────────────────────────────────────────────────────────────
const claimNextBatch = async ({ runId, batchSize, invocationStartedAt }) => {
  const batchItems = await RetailerMultiplierTransactionShadow.find({
    shadowMultiplierRunId: runId,
    recordType: CHECKPOINT_RECORD_TYPE,
    $or: [
      { runItemStatus: "Pending" },
      {
        runItemStatus: "Failed",
        $or: [
          { processedAt: { $lt: invocationStartedAt } },
          { processedAt: null },
        ],
      },
    ],
  })
    .sort({ _id: 1 })
    .limit(batchSize)
    .lean();

  if (!batchItems.length) return [];

  const itemIds = batchItems.map((item) => item._id);

  await RetailerMultiplierTransactionShadow.updateMany(
    { _id: { $in: itemIds } },
    {
      $set: {
        runItemStatus: "Processing",
        processingStartedAt: new Date(),
      },
      $inc: { attempts: 1 },
      $unset: { lastError: "" },
    },
  );

  return RetailerMultiplierTransactionShadow.find({ _id: { $in: itemIds } })
    .sort({ _id: 1 })
    .lean();
};

// ─────────────────────────────────────────────────────────────────────────────
// Core calculation — mirrors ProcessRetailerMultiplierTransaction exactly.
//
// FIX 1 (deliveryDate boundary): $lt → $lte on the Bill query so that bills
//   whose deliveryDate is stored as the exact end-of-month UTC millisecond
//   (e.g. 2026-02-28T18:29:59.999Z  ≡  2026-02-28 23:59:59.999 IST) are
//   correctly included in the month's calculation.
//
// FIX 2 (sales-return filter): The filter now correctly uses the REQUESTED
//   month/year (not currentMonth) when deciding which sales-return transactions
//   belong to this billing period.
// ─────────────────────────────────────────────────────────────────────────────
const calculateShadowTransactionsForRetailer = async ({
  retailerId,
  retailerName,
  retailerCode,
  month,
  year,
  multiplierType,
  rewardSlabs,
  runId,
}) => {
  const { startDate, endDate } = getProcessingWindow(month, year);

  const [bills, dbTransactions, salesReturnDbTransactions, consistency] =
    await Promise.all([
      Bill.find({
        retailerId,
        status: "Delivered",
        // FIX 1: $lte instead of $lt — includes bills at the exact end-of-month boundary
        "dates.deliveryDate": { $gte: startDate, $lte: endDate },
      }).lean(),

      DistributorTransaction.find({
        retailerId,
        transactionType: "debit",
        transactionFor: "SALES",
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .sort({ createdAt: -1 })
        .lean(),

      DistributorTransaction.find({
        retailerId,
        transactionType: "credit",
        transactionFor: "Sales Return",
        createdAt: { $gte: startDate, $lte: endDate }, // FIX 1: $lte
      })
        .sort({ createdAt: -1 })
        .populate({
          path: "salesReturnId",
          populate: { path: "billId" },
        })
        .lean(),

      getRetailersBillMonthConsistency(retailerId, month, year),
    ]);
  console.log("Bills:", bills);
  const totalBillAmount = bills.reduce(
    (acc, bill) => acc + (Number(bill?.netAmount) || 0),
    0,
  );

  // FIX 2: Filter sales-return transactions whose linked bill was delivered in
  // the REQUESTED month/year (original code incorrectly used currentMonth from
  // closure, causing wrong deductions for historical month runs).
  const salesReturnTransactionsForRequestedMonth =
    salesReturnDbTransactions.filter((transaction) => {
      const deliveryDate =
        transaction.salesReturnId?.billId?.dates?.deliveryDate;
      if (!deliveryDate) return false;
      const billMoment = moment(deliveryDate).tz("Asia/Kolkata");
      return (
        billMoment.month() + 1 === Number(month) &&
        billMoment.year() === Number(year)
      );
    });

  const totalPointsDebit = Number(
    salesReturnTransactionsForRequestedMonth.reduce(
      (acc, transaction) => acc + (Number(transaction.point) || 0),
      0,
    ),
  );

  const totalPointsCredit = Number(
    dbTransactions.reduce(
      (acc, transaction) => acc + (Number(transaction.point) || 0),
      0,
    ),
  );

  const totalPoints = totalPointsCredit - totalPointsDebit;

  const {
    volumeMultiplierSlab,
    consistencyMultiplierSlab,
    billVolumeMultiplierSlab,
  } = rewardSlabs;

  let volumeMultiplierPoint = 0;
  let volumeMultiplierPercentage = 0;
  let billVolumeMultiplierPoint = 0;
  let billVolumeMultiplierPercentage = 0;
  let consistencyMultiplierPoint = 0;
  let consistencyMultiplierPercentage = 0;

  const monthName = moment()
    .month(month - 1)
    .format("MMMM");
  const shadowRunId = `${runId}_${retailerId}`;
  const transactionsToSave = [];

  // ── Volume Multiplier ──────────────────────────────────────────────────────
  if (
    (multiplierType === "all" || multiplierType === "monthly") &&
    volumeMultiplierSlab &&
    volumeMultiplierSlab.status?.toLowerCase() === "active" &&
    totalPoints > 0
  ) {
    const applicableSlab = [...volumeMultiplierSlab.slabs]
      .sort((a, b) => Number(b.slabName) - Number(a.slabName))
      .find((slab) => Number(totalPoints) >= Number(slab.slabName));

    volumeMultiplierPercentage = applicableSlab?.percentage || 0;

    if (applicableSlab) {
      volumeMultiplierPoint = Math.round(
        (Number(applicableSlab.percentage) * totalPoints) / 100,
      );

      transactionsToSave.push({
        recordType: TRANSACTION_RECORD_TYPE,
        retailerId,
        retailerCode,
        retailerName,
        transactionType: "credit",
        transactionFor: "Volume Multiplier",
        point: volumeMultiplierPoint,
        slabPercentage: volumeMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Pending",
        remark: `Volume Multiplier for ${monthName}, ${year} based on total points ${totalPoints}`,
        shadowMultiplierRunId: runId,
        shadowRunId,
        shadowRunResult: {
          retailerName,
          retailerCode,
          totalBillAmount,
          totalPointsCredit,
          totalPointsDebit,
          totalPoints,
          consistency,
        },
      });
    }
  }

  // ── Bill Volume Multiplier ─────────────────────────────────────────────────
  if (
    (multiplierType === "all" || multiplierType === "monthly") &&
    billVolumeMultiplierSlab &&
    billVolumeMultiplierSlab.status?.toLowerCase() === "active" &&
    totalBillAmount > 0 &&
    totalPoints > 0
  ) {
    const applicableSlab = [...billVolumeMultiplierSlab.slabs]
      .sort((a, b) => Number(b.slabName) - Number(a.slabName))
      .find((slab) => Number(totalBillAmount) >= Number(slab.slabName));

    billVolumeMultiplierPercentage = applicableSlab?.percentage || 0;

    if (applicableSlab) {
      billVolumeMultiplierPoint = Math.round(
        (Number(applicableSlab.percentage) * totalPoints) / 100,
      );

      transactionsToSave.push({
        recordType: TRANSACTION_RECORD_TYPE,
        retailerId,
        retailerCode,
        retailerName,
        transactionType: "credit",
        transactionFor: "Bill Volume Multiplier",
        point: billVolumeMultiplierPoint,
        slabPercentage: billVolumeMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Pending",
        remark: `Bill Volume Multiplier for ${monthName}, ${year} based on total bill amount ${totalBillAmount} and total points ${totalPoints}`,
        shadowMultiplierRunId: runId,
        shadowRunId,
        shadowRunResult: {
          retailerName,
          retailerCode,
          totalBillAmount,
          totalPointsCredit,
          totalPointsDebit,
          totalPoints,
          consistency,
        },
      });
    }
  }

  // ── Consistency Multiplier ─────────────────────────────────────────────────
  if (
    (multiplierType === "all" || multiplierType === "consistency") &&
    consistencyMultiplierSlab &&
    consistencyMultiplierSlab.status?.toLowerCase() === "active" &&
    consistency > 0 &&
    totalPoints > 0
  ) {
    const applicableSlab = consistencyMultiplierSlab.slabs.find(
      (slab) => slab.slabName === `${consistency} Months`,
    );

    consistencyMultiplierPercentage = applicableSlab?.percentage || 0;

    if (applicableSlab) {
      consistencyMultiplierPoint = Math.round(
        (Number(applicableSlab.percentage) * totalPoints) / 100,
      );

      transactionsToSave.push({
        recordType: TRANSACTION_RECORD_TYPE,
        retailerId,
        retailerCode,
        retailerName,
        transactionType: "credit",
        transactionFor: "Consistency Multiplier",
        point: consistencyMultiplierPoint,
        slabPercentage: consistencyMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Pending",
        remark: `Consistency Multiplier for ${monthName}, ${year} based on ${consistency} months consistency and total points ${totalPoints}`,
        shadowMultiplierRunId: runId,
        shadowRunId,
        shadowRunResult: {
          retailerName,
          retailerCode,
          totalBillAmount,
          totalPointsCredit,
          totalPointsDebit,
          totalPoints,
          consistency,
        },
      });
    }
  }

  return {
    shadowRunId,
    transactionsToSave,
    summary: {
      totalBillAmount,
      totalPointsCredit,
      totalPointsDebit,
      totalPoints,
      consistency,
      volumeMultiplierPoint,
      volumeMultiplierPercentage,
      billVolumeMultiplierPoint,
      billVolumeMultiplierPercentage,
      consistencyMultiplierPoint,
      consistencyMultiplierPercentage,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Process a single checkpoint item: calculate → delete old transactions →
// insert new transactions → update checkpoint status.
// ─────────────────────────────────────────────────────────────────────────────
const processRunItem = async ({ item, run, rewardSlabs }) => {
  const shadowRunId = `${run._id}_${item.retailerId}`;

  try {
    const calculation = await calculateShadowTransactionsForRetailer({
      retailerId: item.retailerId,
      retailerName: item.retailerName,
      retailerCode: item.retailerCode,
      month: run.month,
      year: run.year,
      multiplierType: run.multiplierType,
      rewardSlabs,
      runId: run._id,
    });

    // Delete any previously generated transaction records for this run/retailer
    // before inserting the freshly calculated set (idempotent re-runs).
    await RetailerMultiplierTransactionShadow.deleteMany({
      shadowRunId,
      recordType: TRANSACTION_RECORD_TYPE,
    });

    const filteredToSave = calculation.transactionsToSave || [];

    if (filteredToSave.length) {
      await RetailerMultiplierTransactionShadow.insertMany(filteredToSave);
    }

    // Record reason codes when no transactions were generated (audit visibility).
    const reasonCodes = [];
    if (filteredToSave.length === 0) {
      const s = calculation.summary || {};
      if (Number(s.totalPoints) === 0) reasonCodes.push("ZERO_POINTS");
      if (Number(s.totalBillAmount) === 0) reasonCodes.push("ZERO_BILL_AMOUNT");
      if (Number(s.consistency) === 0) reasonCodes.push("NO_CONSISTENCY");
      if (!reasonCodes.length) reasonCodes.push("NO_APPLICABLE_SLAB");
    }

    await RetailerMultiplierTransactionShadow.findByIdAndUpdate(item._id, {
      $set: {
        runItemStatus: "Completed",
        processedAt: new Date(),
        shadowRunId,
        transactionsGenerated: filteredToSave.length,
        shadowRunResult: { ...(calculation.summary || {}), reasonCodes },
        lastError: null,
      },
      $unset: { processingStartedAt: "" },
    });

    return {
      retailerId: item.retailerId,
      retailer: item.retailerName,
      retailerCode: item.retailerCode,
      shadowRunId,
      status: "Completed",
      transactionsGenerated: filteredToSave.length,
      summary: calculation.summary,
    };
  } catch (error) {
    await RetailerMultiplierTransactionShadow.findByIdAndUpdate(item._id, {
      $set: {
        runItemStatus: "Failed",
        processedAt: new Date(),
        shadowRunId,
        transactionsGenerated: 0,
        lastError: error.message,
      },
      $unset: { processingStartedAt: "" },
    });

    return {
      retailerId: item.retailerId,
      retailer: item.retailerName,
      retailerCode: item.retailerCode,
      shadowRunId,
      status: "Failed",
      error: error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Drive the batch-processing loop for a run.
// ─────────────────────────────────────────────────────────────────────────────
const executeShadowRun = async ({
  run,
  batchSize,
  processRemaining,
  maxBatches,
}) => {
  const invocationStartedAt = new Date();
  const rewardSlabs = await fetchRewardSlabs();
  const processedRetailers = [];
  let batchesProcessed = 0;

  await markStaleProcessingItemsPending(run._id);
  await refreshShadowRunProgress(run._id, {
    batchSize,
    lastHeartbeatAt: new Date(),
    lastError: null,
  });

  while (true) {
    const latestRun = await RetailerMultiplierShadowRun.findById(
      run._id,
    ).lean();
    const nextBatchNumber = Number(latestRun?.currentBatchNumber || 0) + 1;

    const batchItems = await claimNextBatch({
      runId: run._id,
      batchSize,
      invocationStartedAt,
    });

    if (!batchItems.length) break;

    await RetailerMultiplierShadowRun.findByIdAndUpdate(run._id, {
      $set: {
        currentBatchNumber: nextBatchNumber,
        batchSize,
        lastHeartbeatAt: new Date(),
      },
    });

    // Process the batch in concurrency-limited chunks.
    for (
      let chunkStart = 0;
      chunkStart < batchItems.length;
      chunkStart += DEFAULT_ITEM_CONCURRENCY
    ) {
      const chunk = batchItems.slice(
        chunkStart,
        chunkStart + DEFAULT_ITEM_CONCURRENCY,
      );

      const chunkResults = await Promise.all(
        chunk.map((item) => processRunItem({ item, run, rewardSlabs })),
      );

      processedRetailers.push(...chunkResults);

      // Heartbeat after every chunk so the run is not incorrectly reclaimed.
      await RetailerMultiplierShadowRun.findByIdAndUpdate(run._id, {
        $set: { lastHeartbeatAt: new Date() },
      });
    }

    batchesProcessed++;

    await refreshShadowRunProgress(run._id, {
      currentBatchNumber: nextBatchNumber,
      batchSize,
      lastHeartbeatAt: new Date(),
      lastError: null,
    });

    if (maxBatches && batchesProcessed >= maxBatches) break;
    if (!processRemaining) break;

    await sleep(100);
  }

  const updatedRun = await refreshShadowRunProgress(run._id, {
    batchSize,
    lastHeartbeatAt: new Date(),
  });

  return {
    run: updatedRun,
    batchSummary: {
      batchesProcessed,
      batchSize,
      processedRetailers: processedRetailers.length,
      hasMore: updatedRun.status !== "Completed",
    },
    processedRetailers,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable status message for the response body.
// ─────────────────────────────────────────────────────────────────────────────
const buildExecutionMessage = ({
  createdNewRun,
  resumedExistingRun,
  runStatus,
}) => {
  if (createdNewRun)
    return `Shadow run created successfully. Current status: ${runStatus}.`;
  if (resumedExistingRun)
    return `Shadow run resumed successfully. Current status: ${runStatus}.`;
  return `Shadow run processed successfully. Current status: ${runStatus}.`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared handler used by both the legacy endpoint and the new start endpoint.
// ─────────────────────────────────────────────────────────────────────────────
const handleShadowRunStart = async (
  req,
  res,
  { processRemainingDefault = false, legacyResponse = false } = {},
) => {
  const {
    month: monthRaw,
    year: yearRaw,
    retailerId,
    retailerIds,
    allRetailers,
  } = req.body;

  const currentMonth = moment().tz("Asia/Kolkata").month() + 1;
  const currentYear = moment().tz("Asia/Kolkata").year();

  const missing = ["month", "year"].filter(
    (f) => req.body[f] === undefined || req.body[f] === null,
  );
  const hasRetailerSelection =
    !!retailerId ||
    (Array.isArray(retailerIds) && retailerIds.length) ||
    !!allRetailers;

  if (missing.length || !hasRetailerSelection) {
    return res.status(400).json({
      status: 400,
      message: "Missing required fields: month, year, and retailer selection",
    });
  }

  const month = Number(monthRaw);
  const year = Number(yearRaw);

  if (
    !Number.isFinite(month) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return res.status(400).json({
      status: 400,
      message: "Invalid month. It should be an integer between 1 and 12.",
    });
  }

  if (
    !Number.isFinite(year) ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > new Date().getFullYear()
  ) {
    return res.status(400).json({
      status: 400,
      message: "Invalid year. It should be between 2000 and current year.",
    });
  }

  if (month === currentMonth && year === currentYear) {
    return res.status(400).json({
      status: 400,
      message: "Cannot process transactions for the current month.",
    });
  }

  if (year === currentYear && month > currentMonth) {
    return res.status(400).json({
      status: 400,
      message: "Cannot process transactions for future months.",
    });
  }

  const multiplierType = normalizeMultiplierType(req.body.multiplierType);
  if (!VALID_MULTIPLIER_TYPES.has(multiplierType)) {
    return res.status(400).json({
      status: 400,
      message:
        "Invalid multiplierType. Allowed values are: all, monthly, consistency.",
    });
  }

  const processRemaining =
    req.body.processRemaining === undefined
      ? processRemainingDefault
      : Boolean(req.body.processRemaining);
  const batchSize = normalizeBatchSize(req.body.batchSize);
  const requestedMaxBatches = normalizeMaxBatches(req.body.maxBatches);
  const maxBatches = requestedMaxBatches || (processRemaining ? null : 1);

  let resolvedRetailers;
  try {
    resolvedRetailers = await resolveRetailersFromRequest({
      retailerId,
      retailerIds,
      allRetailers,
    });
  } catch (error) {
    const statusCode =
      error.message === "Retailer not found." ||
      error.message === "No retailers found for processing."
        ? 404
        : 400;
    return res
      .status(statusCode)
      .json({ status: statusCode, message: error.message });
  }

  const runState = await createOrReuseShadowRun({
    month: Number(month),
    year: Number(year),
    multiplierType,
    batchSize,
    selectionType: resolvedRetailers.selectionType,
    requestedRetailerIds: resolvedRetailers.requestedRetailerIds,
    retailerList: resolvedRetailers.retailerList,
  });

  if (runState.alreadyRunning) {
    return res.status(409).json({
      status: 409,
      message: "A matching shadow run is already in progress.",
      run: buildRunSummary(runState.run),
    });
  }

  const acquiredRun = await acquireRunForProcessing(runState.run._id);
  if (!acquiredRun) {
    const currentRun = await RetailerMultiplierShadowRun.findById(
      runState.run._id,
    );
    return res.status(409).json({
      status: 409,
      message: "Shadow run is already in progress.",
      run: currentRun ? buildRunSummary(currentRun) : null,
    });
  }

  try {
    const execution = await executeShadowRun({
      run: acquiredRun,
      batchSize,
      processRemaining,
      maxBatches,
    });

    const payload = {
      status: 200,
      message: buildExecutionMessage({
        createdNewRun: runState.createdNewRun,
        resumedExistingRun: runState.resumedExistingRun,
        runStatus: execution.run.status,
      }),
      run: buildRunSummary(execution.run),
      batchSummary: execution.batchSummary,
      processedRetailers: execution.processedRetailers,
      createdNewRun: runState.createdNewRun,
      resumedExistingRun: runState.resumedExistingRun,
    };

    if (legacyResponse) {
      payload.results = execution.processedRetailers;
    }

    return res.status(200).json(payload);
  } catch (error) {
    const failedRun = await refreshShadowRunProgress(acquiredRun._id, {
      status: "Incomplete",
      lastHeartbeatAt: new Date(),
      lastError: error.message,
    });

    return res.status(500).json({
      status: 500,
      message: error.message || "Shadow run processing failed.",
      run: failedRun ? buildRunSummary(failedRun) : null,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared handler for resume endpoints.
// ─────────────────────────────────────────────────────────────────────────────
const handleShadowRunResume = async (
  req,
  res,
  { processRemainingDefault = false } = {},
) => {
  const { runId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(runId)) {
    return res.status(400).json({ status: 400, message: "Invalid runId." });
  }

  const existingRun = await RetailerMultiplierShadowRun.findById(runId);
  if (!existingRun) {
    return res
      .status(404)
      .json({ status: 404, message: "Shadow run not found." });
  }

  if (existingRun.status === "Completed") {
    const refreshedRun = await refreshShadowRunProgress(existingRun._id);
    return res.status(200).json({
      status: 200,
      message: "Shadow run is already completed.",
      run: buildRunSummary(refreshedRun),
      batchSummary: {
        batchesProcessed: 0,
        batchSize: existingRun.batchSize,
        processedRetailers: 0,
        hasMore: false,
      },
      processedRetailers: [],
    });
  }

  const processRemaining =
    req.body.processRemaining === undefined
      ? processRemainingDefault
      : Boolean(req.body.processRemaining);
  const batchSize = normalizeBatchSize(
    req.body.batchSize || existingRun.batchSize,
  );
  const requestedMaxBatches = normalizeMaxBatches(req.body.maxBatches);
  const maxBatches = requestedMaxBatches || (processRemaining ? null : 1);

  await markStaleProcessingItemsPending(existingRun._id);

  const acquiredRun = await acquireRunForProcessing(existingRun._id);
  if (!acquiredRun) {
    const currentRun = await RetailerMultiplierShadowRun.findById(runId);
    return res.status(409).json({
      status: 409,
      message: "Shadow run is already in progress.",
      run: currentRun ? buildRunSummary(currentRun) : null,
    });
  }

  try {
    const execution = await executeShadowRun({
      run: acquiredRun,
      batchSize,
      processRemaining,
      maxBatches,
    });

    return res.status(200).json({
      status: 200,
      message: `Shadow run resumed successfully. Current status: ${execution.run.status}.`,
      run: buildRunSummary(execution.run),
      batchSummary: execution.batchSummary,
      processedRetailers: execution.processedRetailers,
    });
  } catch (error) {
    const failedRun = await refreshShadowRunProgress(acquiredRun._id, {
      status: "Incomplete",
      lastHeartbeatAt: new Date(),
      lastError: error.message,
    });

    return res.status(500).json({
      status: 500,
      message: error.message || "Shadow run processing failed.",
      run: failedRun ? buildRunSummary(failedRun) : null,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Public route handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /retailer-multiplier-shadow/process
 * Legacy endpoint — processes all remaining batches and includes a `results`
 * array in the response for backward-compatibility.
 */
const ProcessRetailerMultiplierTransactionShadow = asyncHandler(
  async (req, res) =>
    handleShadowRunStart(req, res, {
      processRemainingDefault: true,
      legacyResponse: true,
    }),
);

/**
 * POST /retailer-multiplier-shadow/start
 * Preferred endpoint — creates or resumes a run and processes all batches.
 */
const startShadowMultiplierRun = asyncHandler(async (req, res) => {
  req.body.processRemaining = true;
  req.body.maxBatches = null;
  return handleShadowRunStart(req, res);
});

/**
 * POST /retailer-multiplier-shadow/:runId/resume
 * Resume an Incomplete/Pending run by its ID.
 */
const resumeShadowMultiplierRun = asyncHandler(async (req, res) =>
  handleShadowRunResume(req, res, { processRemainingDefault: true }),
);

/**
 * GET /retailer-multiplier-shadow/:runId/status
 * Fetch the current progress of a run, including the last 20 failed items.
 */
const getShadowMultiplierRunStatus = asyncHandler(async (req, res) => {
  const { runId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(runId)) {
    return res.status(400).json({ status: 400, message: "Invalid runId." });
  }

  await markStaleProcessingItemsPending(runId);
  const run = await refreshShadowRunProgress(runId);

  if (!run) {
    return res
      .status(404)
      .json({ status: 404, message: "Shadow run not found." });
  }

  const failedItems = await RetailerMultiplierTransactionShadow.find({
    shadowMultiplierRunId: runId,
    recordType: CHECKPOINT_RECORD_TYPE,
    runItemStatus: "Failed",
  })
    .select(
      "retailerId retailerCode retailerName attempts lastError processedAt",
    )
    .sort({ processedAt: -1 })
    .limit(20)
    .lean();

  return res.status(200).json({
    status: 200,
    message: "Shadow run status fetched successfully.",
    run: buildRunSummary(run),
    failedItems,
  });
});

module.exports = {
  ProcessRetailerMultiplierTransactionShadow,
  startShadowMultiplierRun,
  resumeShadowMultiplierRun,
  getShadowMultiplierRunStatus,
};
