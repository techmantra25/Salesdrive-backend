const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerMultiplierTransactionShadow = require("../../../models/retailerMultiplierTransactionShadow.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");
const moment = require("moment-timezone");

// Fields we compare/update
const COMPARE_FIELDS = ["slabPercentage", "monthTotalPoints", "point"];

const buildAggregatedMap = (docs) => {
  const grouped = new Map();
  for (const doc of docs) {
    const key = `${doc.retailerId?._id ?? doc.retailerId}|${doc.transactionFor}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(doc);
  }

  const result = new Map();
  for (const [key, group] of grouped) {
    const first = group[0];
    const retailerRef = first.retailerId;
    const entry = {
      retailerId: String(retailerRef?._id ?? retailerRef),
      transactionFor: first.transactionFor,
      slabPercentage: group.reduce(
        (s, d) => s + (Number(d.slabPercentage) || 0),
        0,
      ),
      monthTotalPoints: group.reduce(
        (s, d) => s + (Number(d.monthTotalPoints) || 0),
        0,
      ),
      point: group.reduce((s, d) => s + (Number(d.point) || 0), 0),
      docs: group,
    };
    result.set(key, entry);
  }

  return result;
};

const getFieldDiffs = (mainAgg, shadowAgg) => {
  return COMPARE_FIELDS.reduce((acc, field) => {
    const mainVal = mainAgg[field] ?? null;
    const shadowVal = shadowAgg[field] ?? null;
    if (Number(mainVal) !== Number(shadowVal)) {
      acc.push({
        field,
        mainValue: mainVal,
        shadowValue: shadowVal,
        delta: Number(shadowVal) - Number(mainVal),
      });
    }
    return acc;
  }, []);
};

const rebuildRetailerBalance = async (retailerId) => {
  // Rebuild balance for a single retailer (mirrors rebuildAllRetailerBalances)
  const txns = await RetailerOutletTransaction.find({
    retailerId,
    status: "Success",
  }).sort({ createdAt: 1, _id: 1 });
  if (!txns.length) return;

  let runningBalance = 0;
  for (const txn of txns) {
    if (txn.transactionType === "credit")
      runningBalance += Number(txn.point || 0);
    else if (txn.transactionType === "debit")
      runningBalance -= Number(txn.point || 0);

    await RetailerOutletTransaction.updateOne(
      { _id: txn._id },
      { $set: { balance: runningBalance } },
      { timestamps: false },
    );
  }

  await OutletApproved.updateOne(
    { _id: retailerId },
    { $set: { currentPointBalance: runningBalance } },
    { timestamps: false },
  );
};

/**
 * Controller: fixShadowVsMainMultiplier
 * - Accepts pagination params (`page`, `limit`) to select the page of main-table
 *   transactions to consider for fixes.
 * - Filters by month/year/transactionFor etc (same shape as paginated endpoint).
 * - Compares main vs shadow for the selected page and applies fixes to main
 *   so that numeric fields match shadow values. Also updates linked outlet
 *   transactions and remarks. After each retailer is fixed, rebuilds that
 *   retailer's balance.
 */
const fixShadowVsMainMultiplier = asyncHandler(async (req, res) => {
  let {
    page = 1,
    limit = 50,
    month,
    year,
    transactionFor,
    multiplierType,
    retailerId,
    retailerIds,
  } = req.body || req.query;
  page = Number(page) || 1;
  limit = Number(limit) || 50;
  const skip = (page - 1) * limit;

  if (!month || !year) {
    res.status(400);
    throw new Error("month and year are required");
  }

  const baseFilter = { month: Number(month), year: Number(year) };
  if (transactionFor) baseFilter.transactionFor = transactionFor;

  // If caller supplied retailer selection, prefer that for base filter
  let requestedRetailerIds = [];
  if (retailerIds && Array.isArray(retailerIds) && retailerIds.length) {
    requestedRetailerIds = retailerIds.map(String);
    baseFilter.retailerId = { $in: requestedRetailerIds };
  } else if (retailerId) {
    requestedRetailerIds = [String(retailerId)];
    baseFilter.retailerId = retailerId;
  }
  // Determine if caller explicitly asked to process ALL retailers. UI may send
  // `selectAll=true` or pass a special 'all' retailer id in `retailerId`/`retailerIds`.
  const rawSelectAll =
    (req.body && (req.body.selectAll ?? req.body.allRetailers)) ??
    (req.query && (req.query.selectAll ?? req.query.allRetailers));
  const retailerIdsArray = Array.isArray(retailerIds)
    ? retailerIds.map(String)
    : [];
  const selectAll =
    rawSelectAll === true ||
    retailerIdsArray.some((r) => String(r).toLowerCase() === "all") ||
    String(retailerId).toLowerCase() === "all";

  // When `selectAll` is true we should ignore retailer filter and process all
  // matching main/shadow docs for the month/year (pagination is ignored).
  if (selectAll) {
    // remove any retailerId constraint from baseFilter
    delete baseFilter.retailerId;
  }

  // Fetch main-table transactions: either the page requested, or all when selectAll
  let mainQuery = RetailerMultiplierTransaction.find(baseFilter).lean();
  if (!selectAll) {
    mainQuery = mainQuery.skip(skip).limit(limit);
  }
  const mainDocs = await mainQuery;

  // Determine targeted retailers: explicit list (when provided and not selectAll),
  // otherwise derive from fetched main docs.
  let targetedRetailerIds = [];
  if (!selectAll && requestedRetailerIds.length) {
    targetedRetailerIds = requestedRetailerIds;
  } else {
    targetedRetailerIds = [
      ...new Set(mainDocs.map((d) => String(d.retailerId))),
    ];
  }

  const shadowFilter = { month: Number(month), year: Number(year) };
  if (transactionFor) shadowFilter.transactionFor = transactionFor;
  if (!selectAll) shadowFilter.retailerId = { $in: targetedRetailerIds };

  const shadowDocs =
    await RetailerMultiplierTransactionShadow.find(shadowFilter).lean();

  // Nothing to do if neither main nor shadow returned any docs
  if (
    (!mainDocs || mainDocs.length === 0) &&
    (!shadowDocs || shadowDocs.length === 0)
  ) {
    return res.status(200).json({
      success: true,
      message: "No retailers found for requested page/filters",
      modified: 0,
    });
  }

  const mainMap = buildAggregatedMap(mainDocs);
  const shadowMap = buildAggregatedMap(shadowDocs);

  const modifiedRetailers = new Set();
  const modifications = [];

  // Compute exact keys that need fixing: either field mismatches or shadow-only
  const keysToFix = new Set();
  for (const [key, mainAgg] of mainMap) {
    const shadowAgg = shadowMap.get(key);
    if (shadowAgg) {
      const diffs = getFieldDiffs(mainAgg, shadowAgg);
      if (diffs.length) keysToFix.add(key);
    }
  }
  for (const [key, shadowAgg] of shadowMap) {
    if (!mainMap.has(key)) keysToFix.add(key);
  }

  for (const [key, mainAgg] of mainMap) {
    if (!keysToFix.has(key)) continue; // only process keys reported as diffs/missing
    const shadowAgg = shadowMap.get(key);
    if (!shadowAgg) continue; // nothing to sync (shouldn't happen because keysToFix filtered)

    const diffs = getFieldDiffs(mainAgg, shadowAgg);
    if (!diffs.length) continue; // already matching

    // Apply changes: update all matching main documents for this retailer+tx
    const [rid, txType] = key.split("|");
    const newValues = {
      slabPercentage: shadowAgg.slabPercentage,
      monthTotalPoints: shadowAgg.monthTotalPoints,
      point: shadowAgg.point,
      isEdited: true,
    };

    // Update documents and linked outlet transactions
    const docsToUpdate = await RetailerMultiplierTransaction.find({
      retailerId: rid,
      transactionFor: txType,
      month: Number(month),
      year: Number(year),
    });

    for (const doc of docsToUpdate) {
      const oldPoint = Number(doc.point || 0);
      const newPoint = Number(shadowAgg.point || 0);

      // desired timestamp: 4th day of the transaction month at 05:30 IST
      const desiredTs = moment
        .tz(
          {
            year: Number(month) || Number(doc.year) || new Date().getFullYear(),
            month: Number(month) ? Number(month) : Number(doc.month) || 1,
            day: 4,
            hour: 5,
            minute: 30,
          },
          "Asia/Kolkata",
        )
        .toDate();

      // Update linked outlet transaction if present
      if (doc.retailerOutletTransactionId) {
        await RetailerOutletTransaction.updateOne(
          { _id: doc.retailerOutletTransactionId },
          {
            $set: {
              point: newPoint,
              updatedAt: desiredTs,
              createdAt: desiredTs,
            },
          },
          { timestamps: false },
        );
      }

      // Update document fields without modifying the existing remark.
      await RetailerMultiplierTransaction.updateOne(
        { _id: doc._id },
        { $set: { ...newValues, updatedAt: desiredTs, createdAt: desiredTs } },
        { timestamps: false },
      );
    }

    modifiedRetailers.add(rid);
    modifications.push({ retailerId: rid, transactionFor: txType, diffs });
  }

  // Handle shadow-only entries: create main entries so main reflects shadow
  for (const [key, shadowAgg] of shadowMap) {
    // process only shadow-only keys that were identified as diffs by compare
    if (!keysToFix.has(key)) continue;
    if (mainMap.has(key)) continue;
    // Create one main doc per shadow aggregated key using the shadow's first doc as template
    const template =
      shadowDocs.find((d) => `${d.retailerId}|${d.transactionFor}` === key) ||
      null;
    if (!template) continue;
    // If the shadow template doesn't include a transactionFor, skip creating
    // a main-table document — avoid inserting an empty/placeholder row.
    if (!template.transactionFor) continue;

    // Avoid creating a duplicate if a main doc already exists for this retailer+tx+month+year
    const exists = await RetailerMultiplierTransaction.findOne({
      retailerId: template.retailerId,
      transactionFor: template.transactionFor,
      month: template.month,
      year: template.year,
    }).lean();
    if (exists) continue;

    // desired timestamp: 4th day of the transaction month at 05:30 IST
    const desiredTs = moment
      .tz(
        {
          year:
            Number(template.year) || Number(year) || new Date().getFullYear(),
          month: Number(template.month) ? Number(template.month) : 0,
          day: 4,
          hour: 5,
          minute: 30,
        },
        "Asia/Kolkata",
      )
      .toDate();

    const newDoc = {
      retailerId: template.retailerId,
      retailerCode: template.retailerCode || "",
      retailerName: template.retailerName || "",
      transactionType: template.transactionType || "credit",
      transactionFor: template.transactionFor,
      point: template.point || 0,
      slabPercentage: template.slabPercentage ?? 0,
      monthTotalPoints: template.monthTotalPoints || 0,
      month: template.month,
      year: template.year,
      // New inserted main docs should be marked Success so points are applied
      status: "Success",
      // keep original remark from shadow (do not append INSERTED_FROM_SHADOW)
      remark: template.remark || "",
      createdAt: desiredTs,
      updatedAt: desiredTs,
    };

    // Create main doc and, if it's a Success, create linked outlet txn and
    // update retailer snapshot balance so points reflect immediately.
    const created = await RetailerMultiplierTransaction.create(newDoc);

    // If created doc is successful and has points, create outlet transaction
    // and update retailer balance.
    try {
      if (
        String(created.status).toLowerCase() === "success" &&
        Number(created.point) !== 0
      ) {
        const lastRetailerTxn = await RetailerOutletTransaction.findOne({
          retailerId: created.retailerId,
        }).sort({ createdAt: -1 });
        const prevBalance = lastRetailerTxn
          ? Number(lastRetailerTxn.balance)
          : Number(
              (await OutletApproved.findById(created.retailerId))
                ?.currentPointBalance,
            ) || 0;

        const retailerTxn = await RetailerOutletTransaction.create({
          retailerId: created.retailerId,
          distributorId: req.user?._id,
          transactionId: await retailerOutletTransactionCode("RTO"),
          transactionType: created.transactionType || "credit",
          transactionFor: created.transactionFor,
          point: Number(created.point) || 0,
          balance:
            created.transactionType === "credit"
              ? prevBalance + Number(created.point)
              : prevBalance - Number(created.point),
          status: "Success",
          remark: created.remark || "",
          createdAt: desiredTs,
          updatedAt: desiredTs,
        });

        // Persist retailerOutletTransactionId back to main doc
        await RetailerMultiplierTransaction.updateOne(
          { _id: created._id },
          { $set: { retailerOutletTransactionId: retailerTxn._id } },
          { timestamps: false },
        );

        // Update OutletApproved currentPointBalance snapshot and set updatedAt
        await OutletApproved.updateOne(
          { _id: created.retailerId },
          {
            $inc: {
              currentPointBalance:
                created.transactionType === "credit"
                  ? Number(created.point)
                  : -Number(created.point),
            },
            $set: { updatedAt: desiredTs },
          },
          { timestamps: false },
        );
      }
    } catch (err) {
      // Don't block overall operation on a snapshot update failure; record modification nonetheless
      console.error(
        "Error creating outlet txn or updating balance:",
        err.message,
      );
    }

    modifiedRetailers.add(String(template.retailerId));
    modifications.push({
      retailerId: String(template.retailerId),
      transactionFor: template.transactionFor,
      diffs: [
        { field: "inserted", mainValue: null, shadowValue: template.point },
      ],
    });
  }

  // Rebuild balance for each modified retailer
  const modifiedList = Array.from(modifiedRetailers);
  for (const rId of modifiedList) {
    if (!mongoose.Types.ObjectId.isValid(rId)) continue;
    try {
      // rebuild in background but await to ensure consistency
      await rebuildRetailerBalance(rId);
    } catch (err) {
      // continue with others
      console.error(`Error rebuilding balance for ${rId}:`, err.message);
    }
  }

  return res.status(200).json({
    success: true,
    modifiedCount: modifications.length,
    modifications,
    rebuiltRetailers: modifiedList,
  });
});

module.exports = { fixShadowVsMainMultiplier };
