const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Supplier = require("../../models/supplier.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");

// ============================================================
// CONFIG
// Which field of the Price document is the per-unit rate used
// for a PO line (gross = orderQty x this rate).
// Options on your Price model: "mrp_price" | "dlp_price" | "rlp_price"
// >>> Set this to whatever your frontend sends as `basicAmt`. <<<
// ============================================================
const PRICE_FIELD = "dlp_price";

// Same fallback slab as createPurchaseOrder when a product has no GST set
const DEFAULT_GST = { cgst: 9, sgst: 9, igst: 18 };

// ============================================================
// HELPERS
// ============================================================

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value) => Number(num(value).toFixed(2));

// Compare in whole paise, tolerate 1 paisa (floating point noise)
const isDifferent = (stored, calculated) =>
  Math.abs(Math.round(num(stored) * 100) - Math.round(num(calculated) * 100)) >
  1;

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const getProductGstRates = (product) => {
  let cgst = num(product.cgst);
  let sgst = num(product.sgst);
  let igst = num(product.igst);

  if (cgst === 0 && sgst === 0 && igst === 0) {
    ({ cgst, sgst, igst } = DEFAULT_GST);
  }

  return { cgst, sgst, igst };
};

// ============================================================
// CORE FUNCTION (import this anywhere)
//
//   const { recalculatePurchaseOrder } = require("./recalculatePurchaseOrder");
//   const result = await recalculatePurchaseOrder(purchaseOrderId);
//   // dry run (report only, no DB write):
//   await recalculatePurchaseOrder(purchaseOrderId, { dryRun: true });
//
// Returns { corrected, hasMismatch, mismatches, data }.
// Throws an Error with .statusCode (400 / 404 / 422) on bad data.
// ============================================================

const recalculatePurchaseOrder = async (
  purchaseOrderId,
  { dryRun = false } = {},
) => {
  console.log(
    "🔄 RECALCULATE PO CALLED | purchaseOrderId:",
    String(purchaseOrderId),
    dryRun ? "| DRY RUN (no DB update)" : "",
  );

  if (!mongoose.Types.ObjectId.isValid(purchaseOrderId)) {
    console.log("❌ RECALCULATE PO: invalid purchase order ID");
    throw httpError(400, "Invalid purchase order ID");
  }

  const po = await PurchaseOrder.findById(purchaseOrderId);
  if (!po) {
    console.log("❌ RECALCULATE PO: purchase order NOT FOUND");
    throw httpError(404, "Purchase order not found");
  }

  console.log("✅ RECALCULATE PO: purchase order found");
  console.log("📌 PO No:", po.purchaseOrderNo);
  console.log("📦 Line Items:", po.lineItems?.length || 0);

  // --------------------------------------------------------
  // IGST vs CGST+SGST: decided by state comparison
  // --------------------------------------------------------
  const [distributor, supplier] = await Promise.all([
    Distributor.findById(po.distributorId).select("stateId").lean(),
    Supplier.findById(po.supplierId).select("stateId").lean(),
  ]);

  if (!distributor) throw httpError(404, "Distributor not found");
  if (!supplier) throw httpError(404, "Supplier not found");

  const distributorStateId = distributor.stateId
    ? distributor.stateId.toString()
    : null;
  const supplierStateId = supplier.stateId ? supplier.stateId.toString() : null;

  if (!distributorStateId || !supplierStateId) {
    throw httpError(
      400,
      "Cannot determine GST type: distributor or supplier is missing a stateId",
    );
  }

  const isInterState = distributorStateId !== supplierStateId;

  console.log(
    "🧾 RECALCULATE PO: GST type =",
    isInterState ? "IGST (inter-state)" : "CGST+SGST (intra-state)",
  );

  // --------------------------------------------------------
  // Load all products + the exact prices referenced by the lines
  // --------------------------------------------------------
  const lines = po.lineItems || [];

  const productIds = [...new Set(lines.map((l) => String(l.product)))];
  const priceIds = [...new Set(lines.map((l) => String(l.price)))];

  const [products, prices] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select("cgst sgst igst")
      .lean(),
    // exact price doc referenced by the line, regardless of its status
    Price.find({ _id: { $in: priceIds } })
      .select(PRICE_FIELD)
      .lean(),
  ]);

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const priceMap = new Map(prices.map((p) => [String(p._id), p]));

  // --------------------------------------------------------
  // LINE ITEMS
  // --------------------------------------------------------
  let totalGross = 0;
  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;
  let totalNet = 0;

  let hasMismatch = false;
  const mismatches = [];

  const calculatedLines = lines.map((item, index) => {
    const product = productMap.get(String(item.product));
    const price = priceMap.get(String(item.price));

    if (!product) {
      throw httpError(404, `Product not found for line ${index + 1}`);
    }
    if (!price) {
      throw httpError(404, `Price not found for line ${index + 1}`);
    }

    const unitPrice = num(price[PRICE_FIELD]);
    if (unitPrice <= 0) {
      throw httpError(
        422,
        `Price ${price._id} has no valid ${PRICE_FIELD} (line ${index + 1})`,
      );
    }

    const grossAmt = round2(num(item.orderQty) * unitPrice);
    const taxableAmt = grossAmt; // PO lines carry no discount

    const rates = getProductGstRates(product);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isInterState) {
      igst = round2((taxableAmt * rates.igst) / 100);
    } else {
      cgst = round2((taxableAmt * rates.cgst) / 100);
      sgst = round2((taxableAmt * rates.sgst) / 100);
    }

    const netAmt = round2(taxableAmt + cgst + sgst + igst);

    totalGross += grossAmt;
    totalTaxable += taxableAmt;
    totalCGST += cgst;
    totalSGST += sgst;
    totalIGST += igst;
    totalNet += netAmt;

    [
      { field: "grossAmt", stored: item.grossAmt, calculated: grossAmt },
      { field: "taxableAmt", stored: item.taxableAmt, calculated: taxableAmt },
      { field: "totalCGST", stored: item.totalCGST, calculated: cgst },
      { field: "totalSGST", stored: item.totalSGST, calculated: sgst },
      { field: "totalIGST", stored: item.totalIGST, calculated: igst },
      { field: "netAmt", stored: item.netAmt, calculated: netAmt },
    ].forEach(({ field, stored, calculated }) => {
      if (isDifferent(stored, calculated)) {
        hasMismatch = true;
        mismatches.push({
          type: "lineItem",
          lineIndex: index,
          product: item.product,
          price: item.price,
          unitPrice,
          orderQty: num(item.orderQty),
          field,
          stored: round2(stored),
          calculated,
          difference: round2(num(stored) - calculated),
        });
      }
    });

    return { grossAmt, taxableAmt, cgst, sgst, igst, netAmt };
  });

  // --------------------------------------------------------
  // HEADER
  // --------------------------------------------------------
  totalGross = round2(totalGross);
  totalTaxable = round2(totalTaxable);
  totalCGST = round2(totalCGST);
  totalSGST = round2(totalSGST);
  totalIGST = round2(totalIGST);
  totalNet = round2(totalNet);

  const totalGSTAmount = round2(totalCGST + totalSGST + totalIGST);

  const totalLines = lines.filter(
    (item) => num(item.orderQty) > 0 || num(item.netAmt) > 0,
  ).length;

  [
    { field: "totalLines", stored: po.totalLines, calculated: totalLines },
    { field: "grossAmount", stored: po.grossAmount, calculated: totalGross },
    { field: "taxableAmount", stored: po.taxableAmount, calculated: totalTaxable },
    { field: "cgst", stored: po.cgst, calculated: totalCGST },
    { field: "sgst", stored: po.sgst, calculated: totalSGST },
    { field: "igst", stored: po.igst, calculated: totalIGST },
    { field: "totalGSTAmount", stored: po.totalGSTAmount, calculated: totalGSTAmount },
    { field: "netAmount", stored: po.netAmount, calculated: totalNet },
  ].forEach(({ field, stored, calculated }) => {
    if (isDifferent(stored, calculated)) {
      hasMismatch = true;
      mismatches.push({
        type: "header",
        field,
        stored: round2(stored),
        calculated,
        difference: round2(num(stored) - calculated),
      });
    }
  });

  const summary = {
    purchaseOrderId: po._id,
    purchaseOrderNo: po.purchaseOrderNo,
    gstType: isInterState ? "IGST" : "CGST+SGST",
    totalLines,
    grossAmount: totalGross,
    taxableAmount: totalTaxable,
    cgst: totalCGST,
    sgst: totalSGST,
    igst: totalIGST,
    totalGSTAmount,
    netAmount: totalNet,
  };

  // --------------------------------------------------------
  // ALL CORRECT -> DO NOT TOUCH THE DATABASE
  // --------------------------------------------------------
  if (!hasMismatch) {
    console.log(
      "✅ RECALCULATE PO: already correct, no DB update | PO No:",
      po.purchaseOrderNo,
    );

    return {
      corrected: false,
      hasMismatch: false,
      mismatches: [],
      data: summary,
    };
  }

  // --------------------------------------------------------
  // MISMATCH FOUND
  // --------------------------------------------------------
  console.log(
    `⚠️ RECALCULATE PO: ${mismatches.length} mismatch(es) found for PO No ${po.purchaseOrderNo}`,
  );
  console.log("RECALCULATE PO MISMATCHES:", JSON.stringify(mismatches, null, 2));

  // dry run -> report only
  if (dryRun) {
    console.log("ℹ️ RECALCULATE PO: dry run, DB NOT updated");

    return {
      corrected: false,
      hasMismatch: true,
      mismatches,
      data: summary,
    };
  }

  // --------------------------------------------------------
  // UPDATE DATABASE (single save; subdocs updated in place so
  // line _ids are preserved)
  // --------------------------------------------------------
  console.log("🛠️ RECALCULATE PO: updating DB with corrected values...");

  po.lineItems.forEach((item, i) => {
    const c = calculatedLines[i];
    item.grossAmt = c.grossAmt;
    item.taxableAmt = c.taxableAmt;
    item.totalCGST = c.cgst;
    item.totalSGST = c.sgst;
    item.totalIGST = c.igst;
    item.netAmt = c.netAmt;
  });

  po.totalLines = totalLines;
  po.grossAmount = totalGross;
  po.taxableAmount = totalTaxable;
  po.cgst = totalCGST;
  po.sgst = totalSGST;
  po.igst = totalIGST;
  po.totalGSTAmount = totalGSTAmount;
  po.netAmount = totalNet;

  await po.save();

  console.log(
    "💾 RECALCULATE PO: corrected and saved | PO No:",
    po.purchaseOrderNo,
  );

  return {
    corrected: true,
    hasMismatch: true,
    mismatches,
    data: { ...summary, mismatchCount: mismatches.length },
  };
};

// ============================================================
// OPTIONAL: Express handler
//   POST /purchase-order/recalculate/:purchaseOrderId?dryRun=true
// ============================================================

const recalculatePurchaseOrderHandler = async (req, res) => {
  try {
    const result = await recalculatePurchaseOrder(req.params.purchaseOrderId, {
      dryRun: req.query.dryRun === "true",
    });

    return res.status(200).json({
      success: true,
      corrected: result.corrected,
      isMismatch: result.hasMismatch,
      message: !result.hasMismatch
        ? "Purchase order calculation is already correct"
        : result.corrected
          ? "Purchase order calculation mismatch found and corrected"
          : "Mismatch found (dry run, nothing saved)",
      data: result.data,
      mismatches: result.mismatches,
    });
  } catch (error) {
    console.error("RECALCULATE PURCHASE ORDER ERROR:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Failed to recalculate purchase order",
      error: error.message,
    });
  }
};

module.exports = { recalculatePurchaseOrder, recalculatePurchaseOrderHandler };