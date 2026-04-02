const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerMultiplierTransactionShadow = require("../../../models/retailerMultiplierTransactionShadow.model");
const { Parser } = require("json2csv");
const archiver = require("archiver");
const ExcelJS = require("exceljs");

const COMPARE_FIELDS = ["slabPercentage", "monthTotalPoints", "point"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const buildAggregatedMap = (docs, includeRetailerMeta = false) => {
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
      outletUID: retailerRef?.outletUID ?? "",
      outletName: retailerRef?.outletName ?? "",
      transactionFor: first.transactionFor,
      slabPercentage: first.slabPercentage ?? null,
      monthTotalPoints: group.reduce(
        (s, d) => s + (Number(d.monthTotalPoints) || 0),
        0,
      ),
      point: group.reduce((s, d) => s + (Number(d.point) || 0), 0),
    };
    if (includeRetailerMeta) {
      entry.retailerCode = first.retailerCode ?? "";
      entry.retailerName = first.retailerName ?? "";
    }
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

const toCsv = (fields, rows) => {
  if (rows.length === 0) return fields.join(",");
  const parser = new Parser({ fields });
  return parser.parse(rows);
};

// ─────────────────────────────────────────────────────────────────────────────
// Audit Report Excel Builder
// Mirrors the "Multiplier Audit Report" format:
//   Row 1  – Title (merged)
//   Row 2  – Summary labels
//   Row 3  – Summary values
//   Row 4  – blank separator
//   Row 5  – Column headers (multi-level: Main | Shadow | Diff)
//   Row 6+ – Data rows
//   Last   – GRAND TOTAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a flat per-retailer audit row from main/shadow maps.
 * Each retailer that appears in either map becomes one row.
 */
const buildAuditRows = (mainMap, shadowMap) => {
  // Group both maps by retailerId so we can emit one row per retailer
  const byRetailer = new Map();

  for (const [key, agg] of mainMap) {
    const rid = agg.retailerId;
    if (!byRetailer.has(rid))
      byRetailer.set(rid, { main: {}, shadow: {}, meta: agg });
    byRetailer.get(rid).main[agg.transactionFor] = agg;
  }
  for (const [key, agg] of shadowMap) {
    const rid = agg.retailerId;
    if (!byRetailer.has(rid))
      byRetailer.set(rid, { main: {}, shadow: {}, meta: agg });
    byRetailer.get(rid).shadow[agg.transactionFor] = agg;
    if (!byRetailer.get(rid).meta) byRetailer.get(rid).meta = agg;
  }

  const rows = [];
  for (const [rid, { main, shadow, meta }] of byRetailer) {
    // Gather all transactionFor types seen
    const txTypes = new Set([...Object.keys(main), ...Object.keys(shadow)]);

    for (const txType of txTypes) {
      const m = main[txType] || null;
      const s = shadow[txType] || null;

      // Determine status
      let status;
      if (!m && s) {
        status = "○ NO MULT (shadow only)";
      } else if (m && !s) {
        status = "⚠ MISSING IN SHADOW";
      } else {
        const diffs = getFieldDiffs(m, s);
        if (diffs.length === 0) {
          status = "✓ MATCHED";
        } else {
          status = "⚠ MISMATCH";
        }
      }

      const retailerCode = s?.retailerCode || meta?.retailerCode || "";
      const outletUID = m?.outletUID || s?.outletUID || meta?.outletUID || "";
      const outletName =
        m?.outletName || s?.outletName || meta?.outletName || "";

      rows.push({
        retailerCode,
        outletUID,
        outletName,
        transactionFor: txType,
        // Main columns
        main_salesPointCredit: m?.monthTotalPoints ?? null,
        main_multiplierCredit: m?.point ?? null,
        main_effectiveSlabPct: m?.slabPercentage ?? null,
        main_monthTotalPoints: m?.monthTotalPoints ?? null,
        main_points: m?.point ?? null,
        // Shadow columns
        shadow_slabPct: s?.slabPercentage ?? null,
        shadow_monthTotalPoints: s?.monthTotalPoints ?? null,
        shadow_points: s?.point ?? null,
        // Diff
        pointsDiff: (m?.point ?? 0) - (s?.point ?? 0),
        status,
      });
    }
  }

  // Sort: matched first, then mismatches, then missing
  const order = {
    "✓ MATCHED": 0,
    "○ NO MULT (shadow only)": 1,
    "⚠ MISMATCH": 2,
    "⚠ MISSING IN SHADOW": 3,
  };
  rows.sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      (a.outletUID > b.outletUID ? 1 : -1),
  );

  return rows;
};

const buildAuditExcel = async ({ mainMap, shadowMap, summary, filter }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Multiplier Audit System";
  wb.created = new Date();

  const ws = wb.addWorksheet("Multiplier Audit Report");

  // ── Color palette ──────────────────────────────────────────────────────────
  const COLORS = {
    title: { bg: "FF1A237E", fg: "FFFFFFFF" }, // deep indigo
    summaryBg: { bg: "FFE8EAF6", fg: "FF1A237E" }, // light indigo
    summaryVal: { bg: "FFFFFFFF", fg: "FF1A237E" },
    headerMain: { bg: "FF1565C0", fg: "FFFFFFFF" }, // blue
    headerShadow: { bg: "FF2E7D32", fg: "FFFFFFFF" }, // green
    headerDiff: { bg: "FF6A1B9A", fg: "FFFFFFFF" }, // purple
    headerGroup: { bg: "FF0D47A1", fg: "FFFFFFFF" }, // dark blue (top group row)
    matched: { bg: "FFE8F5E9", fg: "FF1B5E20" }, // light green
    noMult: { bg: "FFFFF8E1", fg: "FFE65100" }, // amber
    mismatch: { bg: "FFFFEBEE", fg: "FFB71C1C" }, // red
    missingShadow: { bg: "FFFCE4EC", fg: "FF880E4F" }, // pink
    altRow: { bg: "FFF5F5F5" },
    grandTotal: { bg: "FF1A237E", fg: "FFFFFFFF" },
  };

  const font = (color, bold = false, size = 10) => ({
    name: "Arial",
    size,
    bold,
    color: { argb: color },
  });

  const fill = (argb) => ({
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: argb },
  });

  const border = (style = "thin") => ({
    top: { style },
    left: { style },
    bottom: { style },
    right: { style },
  });

  const thinBorder = border("thin");
  const medBorder = border("medium");

  const fmt = (val, isPercent = false) => {
    if (val === null || val === undefined) return "—";
    if (isPercent) return Number(val).toFixed(6);
    return val;
  };

  // ── Column widths (15 data cols + row number) ──────────────────────────────
  // A=RetailerCode, B=UID, C=Name, D=TxType, E=SalesPtCredit, F=MultCredit,
  // G=EffSlabPct, H=MainMTP, I=MainPts,
  // J=ShadSlabPct, K=ShadMTP, L=ShadPts,
  // M=PointsDiff, N=Status
  ws.columns = [
    { key: "retailerCode", width: 14 },
    { key: "outletUID", width: 14 },
    { key: "outletName", width: 38 },
    { key: "transactionFor", width: 24 },
    { key: "main_sales", width: 13 },
    { key: "main_mult", width: 13 },
    { key: "main_slab", width: 13 },
    { key: "main_mtp", width: 15 },
    { key: "main_pts", width: 10 },
    { key: "shad_slab", width: 13 },
    { key: "shad_mtp", width: 15 },
    { key: "shad_pts", width: 10 },
    { key: "diff", width: 11 },
    { key: "status", width: 24 },
  ];

  const TOTAL_COLS = 14; // A–N

  // Helper: apply fill+font+alignment+border to a cell
  const styleCell = (
    cell,
    bgArgb,
    fgArgb,
    {
      bold = false,
      size = 10,
      align = "center",
      wrap = false,
      numFmt,
      border: brd,
    } = {},
  ) => {
    if (bgArgb) cell.fill = fill(bgArgb);
    if (fgArgb) cell.font = font(fgArgb, bold, size);
    cell.alignment = { horizontal: align, vertical: "middle", wrapText: wrap };
    if (numFmt) cell.numFmt = numFmt;
    if (brd) cell.border = brd;
  };

  const mergeStyle = (
    row,
    startCol,
    endCol,
    value,
    bgArgb,
    fgArgb,
    opts = {},
  ) => {
    const cell = row.getCell(startCol);
    cell.value = value;
    ws.mergeCells(row.number, startCol, row.number, endCol);
    styleCell(cell, bgArgb, fgArgb, opts);
  };

  // ── ROW 1: Title ───────────────────────────────────────────────────────────
  const titleRow = ws.addRow([]);
  titleRow.height = 30;
  mergeStyle(
    titleRow,
    1,
    TOTAL_COLS,
    "RETAILER MULTIPLIER TRANSACTION — AUDIT REPORT",
    COLORS.title.bg,
    COLORS.title.fg,
    { bold: true, size: 14, align: "center" },
  );

  // ── ROW 2: Filter info ─────────────────────────────────────────────────────
  const filterParts = [];
  if (filter.month) filterParts.push(`Month: ${filter.month}`);
  if (filter.year) filterParts.push(`Year: ${filter.year}`);
  if (filter.multiplierType && filter.multiplierType !== "all")
    filterParts.push(`Type: ${filter.multiplierType}`);
  const filterStr = filterParts.length
    ? filterParts.join("   |   ")
    : "All Records";

  const filterRow = ws.addRow([]);
  filterRow.height = 18;
  mergeStyle(
    filterRow,
    1,
    TOTAL_COLS,
    `Filters: ${filterStr}   •   Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    "FFE8EAF6",
    "FF3949AB",
    { bold: false, size: 9, align: "center" },
  );

  // ── ROW 3: Summary labels ──────────────────────────────────────────────────
  const sumLabelRow = ws.addRow([]);
  sumLabelRow.height = 20;
  const sumLabels = [
    [1, 2, "Retailers"],
    [3, 4, "Total Sales Pts"],
    [5, 6, "Total Mult Pts"],
    [7, 8, "✓ Matched"],
    [9, 10, "○ No Multiplier"],
    [11, 12, "⚠ Mismatch"],
    [13, 14, "⚠ Missing in Shadow"],
  ];
  for (const [s, e, label] of sumLabels) {
    mergeStyle(
      sumLabelRow,
      s,
      e,
      label,
      COLORS.summaryBg.bg,
      COLORS.summaryBg.fg,
      { bold: true, size: 9, align: "center" },
    );
  }

  // ── ROW 4: Summary values ──────────────────────────────────────────────────
  const matchedCount = summary.matched ?? 0;
  const noMultCount = summary.onlyInShadow ?? 0;
  const mismatchCount = summary.fieldMismatches ?? 0;
  const missingShadow = summary.onlyInMain ?? 0;

  const totalSalesPts = [...mainMap.values()].reduce(
    (s, r) => s + (Number(r.monthTotalPoints) || 0),
    0,
  );
  const totalMultPts = [...mainMap.values()].reduce(
    (s, r) => s + (Number(r.point) || 0),
    0,
  );

  const sumValRow = ws.addRow([]);
  sumValRow.height = 22;
  const sumVals = [
    [1, 2, summary.totalMain ?? 0],
    [3, 4, totalSalesPts],
    [5, 6, totalMultPts],
    [7, 8, matchedCount],
    [9, 10, noMultCount],
    [11, 12, mismatchCount],
    [13, 14, missingShadow],
  ];
  for (const [s, e, val] of sumVals) {
    mergeStyle(sumValRow, s, e, val, "FFFFFFFF", "FF1A237E", {
      bold: true,
      size: 11,
      align: "center",
    });
    const cell = sumValRow.getCell(s);
    cell.border = { bottom: { style: "medium", color: { argb: "FF1A237E" } } };
  }

  // ── ROW 5: blank separator ─────────────────────────────────────────────────
  const sepRow = ws.addRow([]);
  sepRow.height = 6;

  // ── ROW 6: Column group header (Main | Shadow | Diff) ─────────────────────
  const grpRow = ws.addRow([]);
  grpRow.height = 18;
  mergeStyle(grpRow, 1, 4, "", "FFE3F2FD", "FF0D47A1", {}); // identity cols – blank
  mergeStyle(grpRow, 5, 9, "MAIN", COLORS.headerMain.bg, COLORS.headerMain.fg, {
    bold: true,
    size: 10,
  });
  mergeStyle(
    grpRow,
    10,
    12,
    "SHADOW",
    COLORS.headerShadow.bg,
    COLORS.headerShadow.fg,
    { bold: true, size: 10 },
  );
  mergeStyle(
    grpRow,
    13,
    14,
    "DIFF",
    COLORS.headerDiff.bg,
    COLORS.headerDiff.fg,
    { bold: true, size: 10 },
  );

  // ── ROW 7: Column sub-headers ──────────────────────────────────────────────
  const hdrRow = ws.addRow([
    "Retailer\nCode",
    "Retailer\nUID",
    "Retailer Name",
    "Transaction\nFor",
    "Sales Point\nCredit",
    "Multiplier\nCredit",
    "Effective\nSlab %",
    "Month Total\nPoints",
    "Points",
    "Slab %",
    "Month Total\nPoints",
    "Points",
    "Points\nDiff",
    "Status",
  ]);
  hdrRow.height = 36;
  for (let c = 1; c <= 4; c++) {
    styleCell(hdrRow.getCell(c), "FFE3F2FD", "FF0D47A1", {
      bold: true,
      size: 9,
      wrap: true,
      border: thinBorder,
    });
  }
  for (let c = 5; c <= 9; c++) {
    styleCell(hdrRow.getCell(c), COLORS.headerMain.bg, COLORS.headerMain.fg, {
      bold: true,
      size: 9,
      wrap: true,
      border: thinBorder,
    });
  }
  for (let c = 10; c <= 12; c++) {
    styleCell(
      hdrRow.getCell(c),
      COLORS.headerShadow.bg,
      COLORS.headerShadow.fg,
      { bold: true, size: 9, wrap: true, border: thinBorder },
    );
  }
  for (let c = 13; c <= 14; c++) {
    styleCell(hdrRow.getCell(c), COLORS.headerDiff.bg, COLORS.headerDiff.fg, {
      bold: true,
      size: 9,
      wrap: true,
      border: thinBorder,
    });
  }

  // Freeze rows above data
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 7 }];

  // ── DATA ROWS ──────────────────────────────────────────────────────────────
  const auditRows = buildAuditRows(mainMap, shadowMap);
  let rowIndex = 0;

  for (const r of auditRows) {
    rowIndex++;
    const isAlt = rowIndex % 2 === 0;

    // Pick row color based on status
    let rowBg, rowFg;
    if (r.status === "✓ MATCHED") {
      rowBg = isAlt ? "FFE8F5E9" : "FFF1F8E9";
      rowFg = COLORS.matched.fg;
    } else if (r.status.startsWith("○")) {
      rowBg = isAlt ? "FFFFF8E1" : "FFFFFFDE";
      rowFg = COLORS.noMult.fg;
    } else if (r.status.startsWith("⚠ MISMATCH")) {
      rowBg = isAlt ? "FFFFEBEE" : "FFFFF3F4";
      rowFg = COLORS.mismatch.fg;
    } else {
      rowBg = isAlt ? "FFFCE4EC" : "FFFFF0F4";
      rowFg = COLORS.missingShadow.fg;
    }

    const dataRow = ws.addRow([
      r.retailerCode,
      r.outletUID,
      r.outletName,
      r.transactionFor,
      // Main
      fmt(r.main_salesPointCredit),
      fmt(r.main_multiplierCredit),
      fmt(r.main_effectiveSlabPct, true),
      fmt(r.main_monthTotalPoints),
      fmt(r.main_points),
      // Shadow
      fmt(r.shadow_slabPct, true),
      fmt(r.shadow_monthTotalPoints),
      fmt(r.shadow_points),
      // Diff
      r.pointsDiff !== 0 ? r.pointsDiff : "—",
      r.status,
    ]);

    dataRow.height = 16;

    for (let c = 1; c <= TOTAL_COLS; c++) {
      const cell = dataRow.getCell(c);
      cell.fill = fill(rowBg);
      cell.font = { name: "Arial", size: 9, color: { argb: rowFg } };
      cell.alignment = {
        horizontal: c <= 3 ? "left" : "center",
        vertical: "middle",
      };
      cell.border = {
        top: { style: "hair" },
        bottom: { style: "hair" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    }

    // Highlight diff cell if non-zero
    if (r.pointsDiff !== 0) {
      const diffCell = dataRow.getCell(13);
      diffCell.fill = fill("FFFF5722");
      diffCell.font = {
        name: "Arial",
        size: 9,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
    }

    // Bold the status cell
    const statusCell = dataRow.getCell(14);
    statusCell.font = {
      name: "Arial",
      size: 9,
      bold: true,
      color: { argb: rowFg },
    };
  }

  // ── GRAND TOTAL row ────────────────────────────────────────────────────────
  const allMainPts = auditRows.reduce(
    (s, r) =>
      s +
      (r.main_points !== null && r.main_points !== "—"
        ? Number(r.main_points)
        : 0),
    0,
  );
  const allShadPts = auditRows.reduce(
    (s, r) =>
      s +
      (r.shadow_points !== null && r.shadow_points !== "—"
        ? Number(r.shadow_points)
        : 0),
    0,
  );
  const allMainMTP = auditRows.reduce(
    (s, r) =>
      s +
      (r.main_monthTotalPoints !== null && r.main_monthTotalPoints !== "—"
        ? Number(r.main_monthTotalPoints)
        : 0),
    0,
  );
  const allShadMTP = auditRows.reduce(
    (s, r) =>
      s +
      (r.shadow_monthTotalPoints !== null && r.shadow_monthTotalPoints !== "—"
        ? Number(r.shadow_monthTotalPoints)
        : 0),
    0,
  );

  const totalRow = ws.addRow([
    "GRAND TOTAL",
    "",
    "",
    "",
    "",
    allMainPts,
    "",
    allMainMTP,
    allMainPts,
    "",
    allShadMTP,
    allShadPts,
    allMainPts - allShadPts,
    "",
  ]);
  totalRow.height = 20;
  for (let c = 1; c <= TOTAL_COLS; c++) {
    const cell = totalRow.getCell(c);
    cell.fill = fill(COLORS.grandTotal.bg);
    cell.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: COLORS.grandTotal.fg },
    };
    cell.alignment = {
      horizontal: c <= 3 ? "left" : "center",
      vertical: "middle",
    };
    cell.border = medBorder;
  }
  ws.mergeCells(totalRow.number, 1, totalRow.number, 4);

  return wb;
};

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────
const compareRetailerMultiplierTransactions = async (req, res) => {
  try {
    const mainProjection = {
      retailerId: 1,
      transactionFor: 1,
      retailerOutletTransactionId: 1,
      slabPercentage: 1,
      monthTotalPoints: 1,
      point: 1,
      month: 1,
      year: 1,
      _id: 0,
    };
    const shadowProjection = {
      ...mainProjection,
      retailerCode: 1,
      retailerName: 1,
    };
    const outletPopulate = {
      path: "retailerId",
      select: "outletUID outletName",
    };

    const { month, year, retailerId, retailerIds, multiplierType } =
      req.method === "GET" ? req.query : req.body;

    const filter = {};
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    if (retailerId && !retailerIds) {
      filter.retailerId = retailerId;
    } else if (Array.isArray(retailerIds) && retailerIds.length > 0) {
      filter.retailerId = { $in: retailerIds };
    }
    if (multiplierType && multiplierType !== "all") {
      if (multiplierType === "monthly") {
        filter.transactionFor = {
          $in: ["Volume Multiplier", "Bill Volume Multiplier"],
        };
      } else if (multiplierType === "consistency") {
        filter.transactionFor = "Consistency Multiplier";
      }
    }

    const shadowFilter = {
      ...filter,
      $or: [{ recordType: { $exists: false } }, { recordType: "transaction" }],
    };

    const [mainDocs, shadowDocs] = await Promise.all([
      RetailerMultiplierTransaction.find(filter, mainProjection)
        .populate(outletPopulate)
        .lean(),
      RetailerMultiplierTransactionShadow.find(shadowFilter, shadowProjection)
        .populate(outletPopulate)
        .lean(),
    ]);

    const mainMap = buildAggregatedMap(mainDocs, false);
    const shadowMap = buildAggregatedMap(shadowDocs, true);
    const totalShadow = shadowMap.size;

    const diffs = [];
    const matched = [];

    for (const [key, mainAgg] of mainMap) {
      if (!shadowMap.has(key)) {
        diffs.push({
          diffType: "onlyInMain",
          retailerId: mainAgg.retailerId,
          outletUID: mainAgg.outletUID,
          outletName: mainAgg.outletName,
          retailerCode: "",
          retailerName: "",
          transactionFor: mainAgg.transactionFor,
          main: mainAgg,
          shadow: null,
          mismatchFields: [],
          missingFields: COMPARE_FIELDS,
          details: COMPARE_FIELDS.map((f) => ({
            field: f,
            mainValue: mainAgg[f] ?? null,
            shadowValue: null,
            delta: null,
          })),
        });
      } else {
        const shadowAgg = shadowMap.get(key);
        const fieldDiffs = getFieldDiffs(mainAgg, shadowAgg);
        if (fieldDiffs.length > 0) {
          diffs.push({
            diffType: "fieldMismatch",
            retailerId: mainAgg.retailerId,
            outletUID: mainAgg.outletUID || shadowAgg.outletUID,
            outletName: mainAgg.outletName || shadowAgg.outletName,
            retailerCode: shadowAgg.retailerCode,
            retailerName: shadowAgg.retailerName,
            transactionFor: mainAgg.transactionFor,
            main: mainAgg,
            shadow: shadowAgg,
            mismatchFields: fieldDiffs.map((d) => d.field),
            missingFields: [],
            details: fieldDiffs,
          });
        } else {
          matched.push({
            retailerId: mainAgg.retailerId,
            transactionFor: mainAgg.transactionFor,
          });
        }
        shadowMap.delete(key);
      }
    }

    for (const shadowAgg of shadowMap.values()) {
      diffs.push({
        diffType: "onlyInShadow",
        retailerId: shadowAgg.retailerId,
        outletUID: shadowAgg.outletUID,
        outletName: shadowAgg.outletName,
        retailerCode: shadowAgg.retailerCode,
        retailerName: shadowAgg.retailerName,
        transactionFor: shadowAgg.transactionFor,
        main: null,
        shadow: shadowAgg,
        mismatchFields: [],
        missingFields: COMPARE_FIELDS,
        details: COMPARE_FIELDS.map((f) => ({
          field: f,
          mainValue: null,
          shadowValue: shadowAgg[f] ?? null,
          delta: null,
        })),
      });
    }

    const summary = {
      totalMain: mainMap.size,
      totalShadow,
      matched: matched.length,
      onlyInMain: diffs.filter((d) => d.diffType === "onlyInMain").length,
      onlyInShadow: diffs.filter((d) => d.diffType === "onlyInShadow").length,
      fieldMismatches: diffs.filter((d) => d.diffType === "fieldMismatch")
        .length,
      totalDiffs: diffs.length,
      isDifferent: diffs.length > 0,
    };

    // ── JSON ──────────────────────────────────────────────────────────────────
    if (req.query.format === "json" || !req.query.download) {
      return res.status(200).json({ summary, diffs });
    }

    // ── Excel audit report (.xlsx) ────────────────────────────────────────────
    if (req.query.download === "xlsx") {
      // Rebuild full maps (they were mutated during diff, so re-derive)
      const freshMainMap = buildAggregatedMap(mainDocs, true);
      const freshShadowMap = buildAggregatedMap(shadowDocs, true);

      const wb = await buildAuditExcel({
        mainMap: freshMainMap,
        shadowMap: freshShadowMap,
        summary,
        filter: { month, year, multiplierType },
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="multiplier_audit_report.xlsx"',
      );
      await wb.xlsx.write(res);
      return res.end();
    }

    // ── CSV zip (legacy) ──────────────────────────────────────────────────────
    if (req.query.download === "csv") {
      const mainCsvFields = [
        "retailerId",
        "outletUID",
        "outletName",
        "transactionFor",
        "retailerOutletTransactionId",
        "slabPercentage",
        "monthTotalPoints",
        "point",
        "month",
        "year",
      ];
      const mainCsvRows = mainDocs.map((doc) => ({
        retailerId: String(doc.retailerId?._id ?? doc.retailerId),
        outletUID: doc.retailerId?.outletUID ?? "",
        outletName: doc.retailerId?.outletName ?? "",
        transactionFor: doc.transactionFor,
        retailerOutletTransactionId: String(
          doc.retailerOutletTransactionId ?? "",
        ),
        slabPercentage: doc.slabPercentage ?? "",
        monthTotalPoints: doc.monthTotalPoints ?? "",
        point: doc.point ?? "",
        month: doc.month,
        year: doc.year,
      }));
      const mainCsv = toCsv(mainCsvFields, mainCsvRows);

      const shadowCsvFields = [
        "retailerId",
        "outletUID",
        "outletName",
        "retailerCode",
        "retailerName",
        "transactionFor",
        "retailerOutletTransactionId",
        "slabPercentage",
        "monthTotalPoints",
        "point",
        "month",
        "year",
      ];
      const shadowCsvRows = shadowDocs.map((doc) => ({
        retailerId: String(doc.retailerId?._id ?? doc.retailerId),
        outletUID: doc.retailerId?.outletUID ?? "",
        outletName: doc.retailerId?.outletName ?? "",
        retailerCode: doc.retailerCode ?? "",
        retailerName: doc.retailerName ?? "",
        transactionFor: doc.transactionFor,
        retailerOutletTransactionId: String(
          doc.retailerOutletTransactionId ?? "",
        ),
        slabPercentage: doc.slabPercentage ?? "",
        monthTotalPoints: doc.monthTotalPoints ?? "",
        point: doc.point ?? "",
        month: doc.month,
        year: doc.year,
      }));
      const shadowCsv = toCsv(shadowCsvFields, shadowCsvRows);

      const compCsvFields = [
        "diffType",
        "retailerId",
        "outletUID",
        "outletName",
        "retailerCode",
        "retailerName",
        "transactionFor",
        "mismatchFields",
        "missingFields",
        "field",
        "main_value",
        "shadow_value",
        "delta",
      ];
      const compCsvRows = [];
      for (const diff of diffs) {
        for (const detail of diff.details) {
          compCsvRows.push({
            diffType: diff.diffType,
            retailerId: diff.retailerId,
            outletUID: diff.outletUID,
            outletName: diff.outletName,
            retailerCode: diff.retailerCode,
            retailerName: diff.retailerName,
            transactionFor: diff.transactionFor,
            mismatchFields: diff.mismatchFields.join(", "),
            missingFields: diff.missingFields.join(", "),
            field: detail.field,
            main_value: detail.mainValue ?? "",
            shadow_value: detail.shadowValue ?? "",
            delta:
              detail.delta !== null && detail.delta !== undefined
                ? detail.delta
                : "",
          });
        }
      }
      const compCsv = toCsv(compCsvFields, compCsvRows);

      res.header("Content-Type", "application/zip");
      res.attachment("retailer-multiplier-comparison.zip");
      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err) => {
        throw err;
      });
      archive.pipe(res);
      archive.append(mainCsv, { name: "main_data.csv" });
      archive.append(shadowCsv, { name: "shadow_data.csv" });
      archive.append(compCsv, { name: "comparison.csv" });
      await archive.finalize();
      return;
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { compareRetailerMultiplierTransactions };
