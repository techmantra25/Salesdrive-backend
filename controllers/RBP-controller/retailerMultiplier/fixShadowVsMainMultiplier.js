const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const moment = require("moment-timezone");

const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerMultiplierTransactionShadow = require("../../../models/retailerMultiplierTransactionShadow.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");
const {
  calculateNetPoints,
  calculateNewBalance,
} = require("../../../utils/balanceCalculator");

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────────────────────────────

const COMPARE_FIELDS = ["slabPercentage", "monthTotalPoints", "point"];

const buildAggregatedMap = (docs) => {
  const grouped = new Map();
  // Group by retailerId + transactionFor
  for (const doc of docs) {
    const retailerId = String(doc.retailerId?._id ?? doc.retailerId ?? "");
    const txFor = doc.transactionFor ?? "";
    const key = `${retailerId}|${txFor}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(doc);
  }

  const result = new Map();
  for (const [key, group] of grouped) {
    const first = group[0];

    // Use utility function to calculate net points (debits subtract from credits)
    const netPoint = calculateNetPoints(group);

    const entry = {
      retailerId: String(first.retailerId?._id ?? first.retailerId ?? ""),
      transactionFor: first.transactionFor,
      slabPercentage: first.slabPercentage ?? 0,
      monthTotalPoints: group.reduce(
        (s, d) => s + (Number(d.monthTotalPoints) || 0),
        0,
      ),
      point: netPoint,
      docs: group,
    };
    result.set(key, entry);
  }
  return result;
};

const getFieldDiffs = (mainAgg, shadowAgg) => {
  return COMPARE_FIELDS.reduce((acc, field) => {
    const mainVal = Number(mainAgg[field] ?? 0);
    const shadowVal = Number(shadowAgg[field] ?? 0);
    if (mainVal !== shadowVal) {
      acc.push({
        field,
        mainValue: mainVal,
        shadowValue: shadowVal,
        delta: shadowVal - mainVal,
      });
    }
    return acc;
  }, []);
};

/**
 * Generate desired timestamp: 4th day of given month at 05:30 IST.
 */
const getDesiredTimestamp = (month, year) => {
  return moment
    .tz(
      {
        year: Number(year),
        month: Number(month) - 1,
        day: 4,
        hour: 5,
        minute: 30,
      },
      "Asia/Kolkata",
    )
    .toDate();
};

/**
 * Rebuild running balance for a retailer's outlet transactions.
 */
const rebuildRetailerBalance = async (retailerId) => {
  try {
    const txns = await RetailerOutletTransaction.find({
      retailerId,
      status: "Success",
    })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    let runningBalance = 0;
    for (const txn of txns) {
      // Use utility function for consistent balance calculation
      runningBalance = calculateNewBalance(
        runningBalance,
        txn.transactionType,
        txn.point,
      );

      await RetailerOutletTransaction.updateOne(
        { _id: txn._id },
        { $set: { balance: runningBalance } },
        { timestamps: false },
      );
    }

    // Update outlet snapshot
    await OutletApproved.updateOne(
      { _id: retailerId },
      { $set: { currentPointBalance: runningBalance } },
      { timestamps: false },
    );
  } catch (err) {
    throw new Error(
      `Failed to rebuild balance for ${retailerId}: ${err.message}`,
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /fix-shadow-vs-main
 *
 * Fix discrepancies between main and shadow tables:
 * - Update main fields (slabPercentage, monthTotalPoints, point) to match shadow
 * - Create missing main entries from shadow (when shadow exists but main doesn't)
 * - Update linked outlet transactions with proper remarks
 * - Rebuild retailer balance after fixes
 *
 * Request body:
 *   month, year (required)
 *   retailerId, retailerIds, selectAll (optional)
 *   transactionFor (optional)
 *   page, limit (optional, ignored if selectAll=true)
 */
const fixShadowVsMainMultiplier = asyncHandler(async (req, res) => {
  const src = req.body || req.query;
  let {
    month,
    year,
    retailerId,
    retailerIds,
    transactionFor,
    page = 1,
    limit = 50,
    selectAll = false,
  } = src;

  // Validate required params
  if (!month || !year) {
    return res.status(400).json({
      success: false,
      message: "month and year are required",
      received: { month, year },
    });
  }

  // Parse and validate numeric params
  month = parseInt(month, 10);
  year = parseInt(year, 10);
  page = parseInt(page, 10) || 1;
  limit = parseInt(limit, 10) || 50;

  // Additional validation for valid month/year
  if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
    return res.status(400).json({
      success: false,
      message: "Invalid month (1-12) or year value",
      received: { month, year },
    });
  }

  const skip = (page - 1) * limit;

  // Determine retailer selection
  let selectedRetailerIds = [];
  if (selectAll) {
    selectedRetailerIds = [];
  } else if (Array.isArray(retailerIds) && retailerIds.length > 0) {
    selectedRetailerIds = retailerIds
      .map(String)
      .filter((id) => id && id.toLowerCase() !== "all");
  } else if (retailerId && String(retailerId).toLowerCase() !== "all") {
    selectedRetailerIds = [String(retailerId)];
  }

  // Build filters
  const mainFilter = { month, year };
  const shadowFilter = { month, year };

  if (transactionFor) {
    mainFilter.transactionFor = transactionFor;
    shadowFilter.transactionFor = transactionFor;
  }

  if (!selectAll && selectedRetailerIds.length > 0) {
    mainFilter.retailerId = { $in: selectedRetailerIds };
    shadowFilter.retailerId = { $in: selectedRetailerIds };
  }

  // CRITICAL FIX: For fix operations, we MUST fetch ALL records to detect ALL mismatches
  // Pagination is not compatible with mismatch detection - we need the full dataset
  // to compare main vs shadow and identify what needs fixing.
  // Apply pagination only to DISPLAY results, not to PROCESSING data.
  const mainDocs = await RetailerMultiplierTransaction.find(mainFilter).lean();
  const shadowDocs =
    await RetailerMultiplierTransactionShadow.find(shadowFilter).lean();

  if (!mainDocs.length && !shadowDocs.length) {
    return res.status(200).json({
      success: true,
      message: "No transactions found for requested filters",
      modifications: [],
      rebuiltRetailers: [],
    });
  }

  const mainMap = buildAggregatedMap(mainDocs);
  const shadowMap = buildAggregatedMap(shadowDocs);

  const modifications = [];
  const modifiedRetailerIds = new Set();

  // ── PART 1: Fix mismatched fields in main to match shadow ──────────────────
  for (const [key, mainAgg] of mainMap) {
    const shadowAgg = shadowMap.get(key);
    if (!shadowAgg) continue; // No shadow entry; skip

    const diffs = getFieldDiffs(mainAgg, shadowAgg);
    if (!diffs.length) continue; // Already matching

    const [retailerId, txType] = key.split("|");
    const desiredTs = getDesiredTimestamp(month, year);

    // Convert retailerId to ObjectId if needed
    const retailerIdToQuery = mongoose.Types.ObjectId.isValid(retailerId)
      ? new mongoose.Types.ObjectId(retailerId)
      : retailerId;

    // Update all main docs matching this retailer + transactionFor
    const mainDocsToUpdate = await RetailerMultiplierTransaction.find({
      retailerId: retailerIdToQuery,
      transactionFor: txType,
      month,
      year,
    });

    if (mainDocsToUpdate.length === 0) {
      console.warn(`No docs found to update for key ${key}`);
      continue;
    }

    for (const doc of mainDocsToUpdate) {
      try {
        const oldPoint = Number(doc.point || 0);
        const newPoint = Number(shadowAgg.point || 0);
        const pointDelta = newPoint - oldPoint;

        // Build updated remark tracking the fix
        const remarkParts = [];
        if (doc.remark) remarkParts.push(doc.remark);
        // remarkParts.push(
        //   `[FIXED ${new Date().toISOString().split("T")[0]}] slabPct: ${doc.slabPercentage}→${shadowAgg.slabPercentage}, mtp: ${doc.monthTotalPoints}→${shadowAgg.monthTotalPoints}, pt: ${oldPoint}→${newPoint}`,
        // );

        const updatePayload = {
          slabPercentage: shadowAgg.slabPercentage,
          monthTotalPoints: shadowAgg.monthTotalPoints,
          point: newPoint,
          remark: remarkParts.join(" | "),
          isEdited: true,
          updatedAt: desiredTs,
        };

        // Update main doc (don't override createdAt)
        await RetailerMultiplierTransaction.updateOne(
          { _id: doc._id },
          { $set: updatePayload },
          { timestamps: false },
        );

        // Update linked outlet transaction if exists
        if (doc.retailerOutletTransactionId) {
          await RetailerOutletTransaction.updateOne(
            { _id: doc.retailerOutletTransactionId },
            {
              $set: {
                point: newPoint,
                remark: updatePayload.remark,
                updatedAt: desiredTs,
              },
            },
            { timestamps: false },
          );

          // Update outlet balance if point changed
          if (pointDelta !== 0) {
            const txnType = doc.transactionType || "credit";
            const delta = txnType === "credit" ? pointDelta : -pointDelta;
            await OutletApproved.updateOne(
              { _id: retailerIdToQuery },
              {
                $inc: { currentPointBalance: delta },
                $set: { updatedAt: desiredTs },
              },
              { timestamps: false },
            );
          }
        }
      } catch (err) {
        console.error(
          `Error updating doc ${doc._id} for retailer ${retailerId}:`,
          err.message,
        );
        modifications.push({
          type: "UPDATE_FAILED",
          docId: String(doc._id),
          retailerId,
          error: err.message,
        });
      }
    }

    modifiedRetailerIds.add(retailerId);
    modifications.push({
      type: "UPDATED",
      retailerId,
      transactionFor: txType,
      diffs,
      count: mainDocsToUpdate.length,
    });
  }

  // ── PART 2: Create missing main entries from shadow ─────────────────────────
  for (const [key, shadowAgg] of shadowMap) {
    if (mainMap.has(key)) continue; // Main entry already exists

    const [retailerId, txType] = key.split("|");
    const desiredTs = getDesiredTimestamp(month, year);

    // Get shadow template doc
    const template = shadowDocs.find(
      (d) => `${d.retailerId}|${d.transactionFor}` === key,
    );
    if (!template || !template.transactionFor) continue; // Invalid template

    // Check if main already exists (redundant but safe)
    // Convert retailerId to ObjectId if needed for comparison
    const retailerIdToQuery = mongoose.Types.ObjectId.isValid(retailerId)
      ? new mongoose.Types.ObjectId(retailerId)
      : retailerId;

    const exists = await RetailerMultiplierTransaction.findOne({
      retailerId: retailerIdToQuery,
      transactionFor: txType,
      month,
      year,
    }).lean();
    if (exists) continue;

    // Create new main doc from shadow
    const newDoc = {
      retailerId: retailerIdToQuery,
      retailerCode: template.retailerCode || "",
      retailerName: template.retailerName || "",
      transactionType: template.transactionType || "credit",
      transactionFor: template.transactionFor,
      point: Number(template.point || 0),
      slabPercentage: Number(template.slabPercentage || 0),
      monthTotalPoints: Number(template.monthTotalPoints || 0),
      month,
      year,
      status: "Success",
      remark:
        `[INSERTED_FROM_SHADOW ${desiredTs.toISOString().split("T")[0]}] ${template.remark || ""}`.trim(),
      createdAt: desiredTs,
      updatedAt: desiredTs,
    };

    try {
      const createdDoc = await RetailerMultiplierTransaction.create(newDoc);

      // If points > 0, create outlet transaction
      if (
        Number(createdDoc.point) > 0 &&
        mongoose.Types.ObjectId.isValid(createdDoc.retailerId)
      ) {
        const lastTxn = await RetailerOutletTransaction.findOne({
          retailerId: createdDoc.retailerId,
        })
          .sort({ createdAt: -1 })
          .lean();
        const prevBalance = lastTxn
          ? Number(lastTxn.balance)
          : (await OutletApproved.findById(createdDoc.retailerId).lean())
              ?.currentPointBalance || 0;

        // Use utility function for consistent balance calculation
        const newBalance = calculateNewBalance(
          prevBalance,
          createdDoc.transactionType,
          createdDoc.point,
        );

        const outletTxn = await RetailerOutletTransaction.create({
          retailerId: createdDoc.retailerId,
          distributorId: req.user?._id,
          transactionId: await retailerOutletTransactionCode("RTO"),
          transactionType: createdDoc.transactionType,
          transactionFor: createdDoc.transactionFor,
          point: Number(createdDoc.point),
          balance: newBalance,
          status: "Success",
          remark: createdDoc.remark,
          createdAt: desiredTs,
          updatedAt: desiredTs,
        });

        // Link outlet txn back to main doc
        await RetailerMultiplierTransaction.updateOne(
          { _id: createdDoc._id },
          { $set: { retailerOutletTransactionId: outletTxn._id } },
          { timestamps: false },
        );

        // Update outlet balance snapshot
        await OutletApproved.updateOne(
          { _id: createdDoc.retailerId },
          {
            $inc: {
              currentPointBalance:
                createdDoc.transactionType === "credit"
                  ? Number(createdDoc.point)
                  : -Number(createdDoc.point),
            },
            $set: { updatedAt: desiredTs },
          },
          { timestamps: false },
        );
      }

      modifiedRetailerIds.add(String(retailerId));
      modifications.push({
        type: "INSERTED",
        retailerId,
        transactionFor: txType,
        point: shadowAgg.point,
        remark: newDoc.remark,
      });
    } catch (err) {
      console.error(
        `Error creating main transaction from shadow for retailer ${retailerId}:`,
        err.message,
      );
      modifications.push({
        type: "INSERT_FAILED",
        retailerId,
        transactionFor: txType,
        error: err.message,
      });
      // Continue: attempt to fix remaining entries
    }
  }

  // ── PART 3: Rebuild balance for all modified retailers ─────────────────────
  const rebuiltRetailers = [];
  const rebuildErrors = [];

  for (const rid of modifiedRetailerIds) {
    if (!mongoose.Types.ObjectId.isValid(rid)) {
      console.warn(`Skipping invalid retailerId: ${rid}`);
      continue;
    }
    try {
      await rebuildRetailerBalance(rid);
      rebuiltRetailers.push(rid);
    } catch (err) {
      console.error(`Balance rebuild error for ${rid}:`, err.message);
      rebuildErrors.push({
        retailerId: rid,
        error: err.message,
      });
      // Continue with other retailers
    }
  }

  const successCount = modifications.filter(
    (m) => m.type === "UPDATED" || m.type === "INSERTED",
  ).length;

  const response = {
    success: true,
    message:
      successCount > 0
        ? `Fixed ${successCount} transaction(s)`
        : "No mismatches found to fix",
    modifications,
    rebuiltRetailers,
    modificationCount: successCount,
  };

  // Add errors if any occurred
  if (rebuildErrors.length > 0) {
    response.rebuildErrors = rebuildErrors;
  }

  return res.status(200).json(response);
});

module.exports = { fixShadowVsMainMultiplier };
