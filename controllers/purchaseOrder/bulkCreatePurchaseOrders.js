const asyncHandler = require("express-async-handler");
const axios = require("axios");

const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Supplier = require("../../models/supplier.model");
const Godown = require("../../models/godown.model");
const Brand = require("../../models/brand.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const {
  purchaseOrderNumberGenerator,
  generateCode,
} = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");


const REQUIRED_ROW_FIELDS = ["brand", "product_code", "uom_qty", "so_number", "godown_code"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDDMMYYYY(dateStr) {
  if (!dateStr) return null;

  const [day, month, year] = dateStr.split("-").map(Number);

  if (!day || !month || !year) return null;

  return new Date(year, month - 1, day);
}

/**
 * Validate the raw `rows` array from req.body. Throws on structural
 * problems (not an array, empty, missing keys on every row) — individual
 * bad values (e.g. a blank product_code on one row) are caught later,
 * per-row, and only fail that row's so_number group.
 */
function validateRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("`rows` must be a non-empty array");
  }

  const sample = rows[0] || {};
  const missingKeys = REQUIRED_ROW_FIELDS.filter((f) => !(f in sample));
  if (missingKeys.length) {
    throw new Error(`Row objects are missing required key(s): ${missingKeys.join(", ")}`);
  }

  return rows.map((row, idx) => ({ ...row, __rowIndex: idx + 1 }));
}

function groupBySoNumber(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(row.so_number || "").trim();
    if (!key) return; // rows without a so_number are skipped, reported separately
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row); // row.__rowIndex already set by validateRows
  });
  return groups;
}

async function resolvePrice(productId, distributor, poDate) {
  const dateFilter = {
    effective_date: { $lte: poDate },
    $or: [{ expiresAt: null }, { expiresAt: { $gte: poDate } }],
  };

  let price = await Price.findOne({
    productId,
    price_type: "distributor",
    distributorId: distributor._id,
    ...dateFilter,
  }).sort({ effective_date: -1 });

  if (!price && distributor.regionId) {
    price = await Price.findOne({
      productId,
      price_type: "regional",
      regionId: distributor.regionId,
      ...dateFilter,
    }).sort({ effective_date: -1 });
  }

  if (!price) {
    price = await Price.findOne({
      productId,
      price_type: "national",
      ...dateFilter,
    }).sort({ effective_date: -1 });
  }

  return price;
}

/**
 * Resolve one row's godown_code to an active Godown belonging to this
 * distributor. Every row in a so_number group must resolve to the SAME
 * godown, since a PurchaseOrder (and its Inventory updates) belongs to
 * exactly one godown — that consistency check happens in the caller
 * before this is used.
 */
async function resolveGodownForCode(godownCode, distributor) {
  return Godown.findOne({
    godownCode: new RegExp(`^${godownCode}$`, "i"),
    distributorId: distributor._id,
    isActive: true,
  });
}

/**
 * Resolve one row object into a lineItem object, or throw with a
 * descriptive message (caller attaches row number for context).
 *
 * GST type (IGST vs CGST/SGST) is decided by the AUTHORITATIVE state
 * comparison between distributor and supplier (isInterState), same as
 * the single-PO controller — never inferred from a product's static
 * igst field. The GST *rate* still comes from the product's own slabs,
 * falling back to a default slab when the product has none configured.
 *
 * NOTE: soNumber lives on the LINE ITEM in the schema (there is no
 * root-level `soNumber` field on PurchaseOrder), so it's set here and
 * carried through on every lineItem this group produces.
 *
 * Inventory (and inventoryId) is resolved per-godown, since stock is
 * tracked godown-wise. godownId here is the group's already-resolved
 * godown (see resolveGodownForCode / createSinglePoFromGroup).
 *
 * Price resolution date: prefers this row's own `po_date`, falls back
 * to the group's `groupPoDate` (the so_number group's manualDate), and
 * finally falls back to "now" if neither is present/parseable.
 */
async function buildLineItemFromRow(row, distributor, isInterState, godownId, groupPoDate) {
  const brandName = String(row.brand || "").trim();
  const productCode = String(row.product_code || "").trim();
  const uomQty = Number(row.uom_qty);
  const soNumber = String(row.so_number || "").trim();

  if (!brandName) throw new Error("Missing brand");
  if (!productCode) throw new Error("Missing product_code");
  if (!uomQty || uomQty <= 0) throw new Error(`Invalid uom_qty "${row.uom_qty}"`);
  if (!soNumber) throw new Error("Missing so_number");

  const brand = await Brand.findOne({
    name: new RegExp(`^${brandName}$`, "i"),
  });
  if (!brand) throw new Error(`Brand not found: "${brandName}"`);

  const product = await Product.findOne({
    product_code: productCode,
    brand: brand._id,
  });
  if (!product) {
    throw new Error(
      `Product not found for code "${productCode}" under brand "${brandName}"`
    );
  }

  const uom = String(product.uom || "pcs").toLowerCase();
  if (!["pcs", "bndl", "box", "coil"].includes(uom)) {
    throw new Error(`Product "${productCode}" has invalid uom "${product.uom}"`);
  }

  const rowPoDate = row.po_date ? parseDDMMYYYY(row.po_date) : null;
  const poDate = rowPoDate || groupPoDate || new Date();

  const price = await resolvePrice(product._id, distributor, poDate);
  if (!price) {
    throw new Error(
      `No price found for product "${productCode}" valid on ${poDate.toDateString()}`
    );
  }

  // Inventory is godown-scoped — look it up (and later update/create it)
  // against this specific godownId, not just distributorId.
  const inventory = await Inventory.findOne({
    productId: product._id,
    distributorId: distributor._id,
    godownId,
  });

  // --- uom_qty -> orderQty (pcs) / boxOrderQty, driven by the PRODUCT's
  //     own uom + pieces-per-unit ---
  const piecesPerUnit = Number(product.no_of_pieces_in_a_box || 0);
  let orderQty;
  let boxOrderQty;

  if (uom === "pcs") {
    orderQty = uomQty;
    boxOrderQty = 0;
  } else {
    if (!piecesPerUnit || piecesPerUnit <= 0) {
      throw new Error(
        `Product "${productCode}" has uom "${uom}" but no valid pieces-per-unit configured`
      );
    }
    boxOrderQty = uomQty;
    orderQty = uomQty * piecesPerUnit;
  }

  // --- basicAmt (Basic Rate) derived like the UI, from resolved price:
  //       basicAmt = mrp_price * (1 - L1DiscountPercentage / 100)
  const mrpPrice = Number(price.mrp_price || 0);
  const l1DiscountPct = Number(price.L1DiscountPercentage || 0);
  const basicAmt = mrpPrice * (1 - l1DiscountPct / 100);

  // --- GST rate resolution from product slabs, with a default fallback ---
  let productCgst = Number(product.cgst || 0);
  let productSgst = Number(product.sgst || 0);
  let productIgst = Number(product.igst || 0);

  if (productCgst === 0 && productSgst === 0 && productIgst === 0) {
    productCgst = 9;
    productSgst = 9;
    productIgst = 18;
  }

  const soValue = orderQty * basicAmt;
  const taxableAmt = soValue;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  // --- GST TYPE decided by state comparison (isInterState), never by
  //     the product's static igst field ---
  if (isInterState) {
    igst = productIgst;
    totalIGST = (soValue * productIgst) / 100;
  } else {
    cgst = productCgst;
    sgst = productSgst;
    totalCGST = (soValue * productCgst) / 100;
    totalSGST = (soValue * productSgst) / 100;
  }

  const totalGST = totalCGST + totalSGST + totalIGST;
  const lineTotal = soValue + totalGST;

  return {
    product: product._id,
    price: price._id,
    inventoryId: inventory ? inventory._id : undefined,
    lineItemUOM: uom,
    soNumber,
    boxOrderQty,
    orderQty,
    l1Basic: l1DiscountPct,
    cgst,
    sgst,
    igst,
    grossAmt: soValue,
    taxableAmt,
    totalCGST,
    totalSGST,
    totalIGST,
    totalGST,
    netAmt: lineTotal,
    usedBasePoint: 0,
    foreclose: false,
    forecloseUom: 0,
    forecloseReason: "",
  };
}

/**
 * Build + save one PurchaseOrder from a group of rows sharing the same
 * so_number.
 *
 * The godown is now resolved HERE, per group, from each row's
 * `godown_code` — every row in the group must agree on the same
 * godown_code (a PurchaseOrder belongs to exactly one godown), which is
 * what allows a single bulk upload to span multiple godowns across
 * different so_number groups.
 *
 * Returns either:
 *   - the saved PurchaseOrder document (success), or
 *   - { success: false, soNumber, rowErrors } if the so_number is a
 *     duplicate, the group's godown_code couldn't be resolved/is
 *     inconsistent, or if one or more rows in the group failed to
 *     resolve (any of these fails the whole so_number group).
 *
 * Throws only for truly fatal, non-row-specific errors (e.g. PO save
 * itself failing) — the caller catches those and records the failure.
 */
async function createSinglePoFromGroup({
  soNumber,
  rows,
  distributor,
  supplierId,
  isInterState,
  selectedBrand,
  selectedPlant,
  expectedDeliveryDate,
  remarks,
  orderRemark,
  status,
  approvedStatus,
  approved_by,
  manualDate,
  totalBasePoints,
}) {
  // --- Resolve this group's godown from each row's godown_code ---
  const rawGodownCodes = rows.map((r) => String(r.godown_code || "").trim());

  if (rawGodownCodes.some((c) => !c)) {
    return {
      success: false,
      soNumber,
      rowErrors: rows.map((row) => ({
        ...row,
        error: "Missing godown_code",
      })),
    };
  }

  const uniqueGodownCodes = [...new Set(rawGodownCodes.map((c) => c.toLowerCase()))];
  if (uniqueGodownCodes.length > 1) {
    return {
      success: false,
      soNumber,
      rowErrors: rows.map((row) => ({
        ...row,
        error: `SO Number "${soNumber}" has rows with different godown_code values (${[
          ...new Set(rawGodownCodes),
        ].join(", ")}) — all rows for one SO/PO must use the same godown`,
      })),
    };
  }

  const godownCode = rawGodownCodes[0];
  const godown = await resolveGodownForCode(godownCode, distributor);

  if (!godown) {
    return {
      success: false,
      soNumber,
      rowErrors: rows.map((row) => ({
        ...row,
        error: `Godown not found for code "${godownCode}"`,
      })),
    };
  }

  const godownId = godown._id;

  // soNumber lives on lineItems, not on the PO root — check for a duplicate
  // across ALL existing purchase orders' line items before doing any work.
  const existing = await PurchaseOrder.findOne({
    "lineItems.soNumber": soNumber,
  });

  if (existing) {
    return {
      success: false,
      soNumber,
      rowErrors: rows.map((row) => ({
        ...row,
        error: `SO Number "${soNumber}" already exists`,
      })),
    };
  }

  const lineItems = [];
  const rowErrors = [];

  for (const row of rows) {
    try {
      const lineItem = await buildLineItemFromRow(row, distributor, isInterState, godownId, manualDate);
      lineItems.push(lineItem);
    } catch (err) {
      rowErrors.push({
        ...row,
        error: err.message,
      });
    }
  }

  // Any bad row fails the whole so_number group — report all row errors
  // together instead of silently creating a partial PO.
  if (rowErrors.length) {
    return {
      success: false,
      soNumber,
      rowErrors,
    };
  }

  if (!lineItems.length) {
    throw new Error(`No valid line items for so_number ${soNumber}`);
  }

  let grossAmountCalc = 0;
  let taxableAmountCalc = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;
  let totalGSTAmountCalc = 0;
  let netAmountCalc = 0;

  for (const item of lineItems) {
    grossAmountCalc += item.grossAmt || 0;
    taxableAmountCalc += item.taxableAmt || 0;
    totalCGST += item.totalCGST || 0;
    totalSGST += item.totalSGST || 0;
    totalIGST += item.totalIGST || 0;
    totalGSTAmountCalc += item.totalGST || 0;
    netAmountCalc += item.netAmt || 0;
  }

  const orderNumber = await purchaseOrderNumberGenerator("PO");

  const newPurchaseOrder = new PurchaseOrder({
    distributorId: distributor._id,
    selectedBrand,
    selectedPlant,
    godownId,
    purchaseOrderNo: orderNumber,
    // NOTE: no root-level `soNumber` here — the schema doesn't define one,
    // so it was being silently stripped on save. Each lineItem above now
    // carries its own soNumber instead, matching the schema.
    supplierId,
    expectedDeliveryDate,
    lineItems,
    manualDate,
    totalLines: lineItems.length,

    grossAmount: grossAmountCalc,
    taxableAmount: taxableAmountCalc,

    cgst: totalCGST,
    sgst: totalSGST,
    igst: totalIGST,

    netAmount: netAmountCalc,
    totalGSTAmount: totalGSTAmountCalc,

    remarks,
    approvedStatus,
    approved_by,
    approvedByType: approved_by ? "Distributor" : undefined,
    status,
    invoicestatus: "Pending",
    orderRemark,
    totalBasePoints,
  });

  let saved;
  try {
    saved = await newPurchaseOrder.save();
  } catch (saveErr) {
    // Catch a duplicate-key race (two concurrent uploads using the same
    // so_number both passing the findOne check above) if a unique index
    // on lineItems.soNumber exists at the DB level.
    if (saveErr.code === 11000) {
      return {
        success: false,
        soNumber,
        rowErrors: rows.map((row) => ({
          ...row,
          error: `SO Number "${soNumber}" already exists`,
        })),
      };
    }
    throw saveErr;
  }

  // Inventory in-transit update — godown-wise, auto-create the Inventory
  // doc if one doesn't yet exist for this product+godown (mirrors the
  // single-PO controller). Best-effort: does not fail the PO if it errors.
  for (const item of lineItems) {
    try {
      const existingInventory = await Inventory.findOne({
        distributorId: distributor._id,
        productId: item.product,
        godownId,
      });

      if (existingInventory) {
        existingInventory.intransitQty += Number(item.orderQty || 0);
        await existingInventory.save();
      } else {
        const invitemId = await generateCode("INVT");

        await Inventory.create({
          productId: item.product,
          distributorId: distributor._id,
          godownId,
          invitemId,
          intransitQty: Number(item.orderQty || 0),
          undeliveredQty: 0,
          damagedQty: 0,
          availableQty: 0,
          reservedQty: 0,
          unsalableQty: 0,
          offerQty: 0,
          totalQty: 0,
          totalStockamtDlp: 0,
          totalStockamtRlp: 0,
          totalUnsalableamtDlp: 0,
          totalUnsalableStockamtRlp: 0,
          normsQty: 0,
          godownType: "main",
          openingStock: false,
        });
      }
    } catch (invErr) {
      // swallow — PO is already saved; log for visibility
      console.error(
        `Inventory update failed for PO ${saved.purchaseOrderNo}, product ${item.product}, godown ${godownId}:`,
        invErr.message
      );
    }
  }

  return saved;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

const bulkCreatePurchaseOrders = asyncHandler(async (req, res) => {
  // protectDisRoute guarantees req.user is a valid distributor
  const distributorUser = req.user;

  if (!distributorUser) {
    return res.status(401).json({
      message: "Distributor authentication failed.",
    });
  }

  const {
    selectedBrand,
    selectedPlant,
    supplierId,
    expectedDeliveryDate,
    remarks,
    orderRemark,
    status = "Confirmed",
    totalBasePoints,
    rows: rawRows,
  } = req.body;

  // Fetch a fresh distributor doc so we have stateId, regionId etc.
  // available regardless of what protectDisRoute attached to req.user.
  const distributor = await Distributor.findById(distributorUser._id);
  if (!distributor) {
    return res.status(404).json({ message: "Distributor not found" });
  }

  let supplier;
  if (supplierId) {
    supplier = await Supplier.findById(supplierId);
  } else {
    supplier = await Supplier.findOne({
      distributorId: distributor._id,
      status: "active",
    });
  }

  if (!supplier) {
    return res.status(404).json({
      message: "No active supplier found for this distributor.",
    });
  }

  // ✅ AUTHORITATIVE STATE COMPARISON — backend decides IGST vs CGST/SGST,
  // never trusts the frontend and never infers it from a product's static
  // igst field.
  const distributorStateId = distributor.stateId
    ? distributor.stateId.toString()
    : null;
  const supplierStateId = supplier.stateId ? supplier.stateId.toString() : null;

  if (!distributorStateId || !supplierStateId) {
    return res.status(400).json({
      message:
        "Cannot determine GST type: distributor or supplier is missing a stateId",
    });
  }

  const isInterState = distributorStateId !== supplierStateId;

  let rows;
  try {
    rows = validateRows(rawRows);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  // --- Approval config (same logic as single-PO controller) ---
  let config = {};
  try {
    const configRes = await axios.get(`${SERVER_URL}/api/v1/config/get-config`);
    config = configRes.data.data;
  } catch (error) {
    return res.status(400).json({
      message: `Error fetching config details: ${error?.response?.data?.message || error.message}`,
    });
  }

  const need_employee_approval_for_po =
    config?.functionalSettings?.need_employee_approval_for_po || "no approval";

  let approvedStatus = "Not Approved";
  let approved_by = null;

  if (need_employee_approval_for_po === "no approval" && status === "Confirmed") {
    approvedStatus = "Approved";
    approved_by = distributor._id;
  }

  const groups = groupBySoNumber(rows);
  const rowsWithoutSoNumber =
    rows.length - Array.from(groups.values()).reduce((s, g) => s + g.length, 0);

  // Informational only — the distinct godown_code values seen across the
  // whole upload, so the client can show what this batch touched.
  const godownCodesInBatch = [
    ...new Set(
      rows
        .map((r) => String(r.godown_code || "").trim())
        .filter(Boolean)
    ),
  ];

  const results = [];

  for (const [soNumber, groupRows] of groups.entries()) {
    const manualDate = parseDDMMYYYY(groupRows[0].po_date);
    const godownCodeForGroup = String(groupRows[0]?.godown_code || "").trim();

    try {
      const result = await createSinglePoFromGroup({
        soNumber,
        rows: groupRows,
        distributor,
        supplierId: supplier._id,
        isInterState,
        selectedBrand,
        selectedPlant,
        expectedDeliveryDate,
        manualDate,
        remarks,
        orderRemark,
        status,
        approvedStatus,
        approved_by,
        totalBasePoints,
      });

      // createSinglePoFromGroup returns { success: false, ... } when the
      // so_number is a duplicate, the group's godown couldn't be
      // resolved, or one or more rows in the group failed — treat that
      // as a failed group instead of assuming success.
      if (result && result.success === false) {
        results.push({
          soNumber,
          godownCode: godownCodeForGroup,
          success: false,
          error: "One or more rows failed validation; purchase order was not created.",
          rowErrors: result.rowErrors,
        });
        continue;
      }

      const saved = result;
      results.push({
        soNumber,
        godownCode: godownCodeForGroup,
        success: true,
        purchaseOrderId: saved._id,
        purchaseOrderNo: saved.purchaseOrderNo,
        totalLines: saved.totalLines,
        netAmount: saved.netAmount,
      });
    } catch (err) {
      results.push({
        soNumber,
        godownCode: godownCodeForGroup,
        success: false,
        error: err.message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  return res.status(207).json({
    status: 207,
    message: `Processed ${results.length} purchase order(s): ${successCount} created, ${failureCount} failed.`,
    godownCodes: godownCodesInBatch,
    rowsWithoutSoNumberSkipped: rowsWithoutSoNumber,
    results,
  });
});

module.exports = { bulkCreatePurchaseOrders };