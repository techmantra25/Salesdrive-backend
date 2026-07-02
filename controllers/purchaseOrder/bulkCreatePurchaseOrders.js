
const asyncHandler = require("express-async-handler");
const axios = require("axios");

const PurchaseOrder = require("../../models/purchaseOrder.model");
const Supplier = require("../../models/supplier.model");
const Brand = require("../../models/brand.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { purchaseOrderNumberGenerator } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config");

const REQUIRED_ROW_FIELDS = ["brand", "product_code", "uom_qty", "so_number"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Pick the best-matching active Price doc for a product.
 * Preference: distributor-specific -> regional (distributor's region) -> national.
 */
async function resolvePrice(productId, distributor) {
  let price = await Price.findOne({
    productId,
    status: true,
    price_type: "distributor",
    distributorId: distributor._id,
  });

  if (!price && distributor.regionId) {
    price = await Price.findOne({
      productId,
      status: true,
      price_type: "regional",
      regionId: distributor.regionId,
    });
  }

  if (!price) {
    price = await Price.findOne({
      productId,
      status: true,
      price_type: "national",
    });
  }

  return price;
}

/**
 * Resolve one row object into a lineItem object, or throw with a
 * descriptive message (caller attaches row number for context).
 */
async function buildLineItemFromRow(row, distributor) {
  const brandName = String(row.brand || "").trim();
  const productCode = String(row.product_code || "").trim();
  const uomQty = Number(row.uom_qty);

  if (!brandName) throw new Error("Missing brand");
  if (!productCode) throw new Error("Missing product_code");
  if (!uomQty || uomQty <= 0) throw new Error(`Invalid uom_qty "${row.uom_qty}"`);

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

  const price = await resolvePrice(product._id, distributor);
  if (!price) {
    throw new Error(`No active price found for product "${productCode}"`);
  }

  const inventory = await Inventory.findOne({
    productId: product._id,
    distributorId: distributor._id,
  });

  // --- uom_qty -> orderQty (pcs) / boxOrderQty, driven by the PRODUCT's
  //     own uom + pieces-per-unit (see assumption #4 at top of file) ---
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

  // --- basicAmt (Basic Rate) derived like the UI, from resolved price
  //     (see assumption #2 at top of file):
  //       basicAmt = mrp_price * (1 - L1DiscountPercentage / 100)
  const mrpPrice = Number(price.mrp_price || 0);
  const l1DiscountPct = Number(price.L1DiscountPercentage || 0);
  const basicAmt = mrpPrice * (1 - l1DiscountPct / 100);

  // --- GST resolution (mirrors single-PO controller logic) ---
  let cgst = Number(product.cgst || 0);
  let sgst = Number(product.sgst || 0);
  let igst = Number(product.igst || 0);

  if (cgst === 0 && sgst === 0 && igst === 0) {
    cgst = 9;
    sgst = 9;
    igst = 0;
  }

  const soValue = orderQty * basicAmt;
  const taxableAmt = soValue;

  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  if (igst > 0) {
    totalIGST = (soValue * igst) / 100;
  } else {
    totalCGST = (soValue * cgst) / 100;
    totalSGST = (soValue * sgst) / 100;
  }

  const totalGST = totalCGST + totalSGST + totalIGST;
  const lineTotal = soValue + totalGST;

  return {
    product: product._id,
    price: price._id,
    inventoryId: inventory ? inventory._id : undefined,
    lineItemUOM: uom,
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
 * Build + save one PurchaseOrderEntry from a group of rows sharing the
 * same so_number. Returns a result object; throws only on truly fatal
 * per-group errors (caller catches and records the failure).
 */
async function createSinglePoFromGroup({
  soNumber,
  rows,
  distributor,
  supplierId,
  selectedBrand,
  selectedPlant,
  expectedDeliveryDate,
  remarks,
  orderRemark,
  status,
  approvedStatus,
  approved_by,
}) {
  const lineItems = [];

  for (const row of rows) {
    try {
      const lineItem = await buildLineItemFromRow(row, distributor);
      lineItems.push(lineItem);
    } catch (err) {
      // Attach row context and bubble up — this fails the whole so_number group
      const lineItems = [];
const rowErrors = [];

for (const row of rows) {
  try {
    const lineItem = await buildLineItemFromRow(row, distributor);
    lineItems.push(lineItem);
  } catch (err) {
    rowErrors.push({
      ...row,
      error: err.message,
    });
  }
}

if (rowErrors.length) {
  return {
    success: false,
    rowErrors,
  };
}
    }
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
    purchaseOrderNo: orderNumber,
    soNumber,
    supplierId,
    expectedDeliveryDate,
    lineItems,
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
  });

  const saved = await newPurchaseOrder.save();

  // Best-effort inventory update — does not fail the PO if it errors
  for (const item of lineItems) {
    try {
      await Inventory.findOneAndUpdate(
        { distributorId: distributor._id, productId: item.product },
        { $inc: { intransitQty: Number(item.orderQty || 0) } },
        { new: true }
      );
    } catch (invErr) {
      // swallow — PO is already saved; log for visibility
      console.error(
        `Inventory update failed for PO ${saved.purchaseOrderNo}, product ${item.product}:`,
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
const distributor = req.user;

if (!distributor) {
  return res.status(401).json({
    message: "Distributor authentication failed.",
  });
}

console.log("Distributor:", distributor._id);
const supplier = await Supplier.findOne({
  distributorId: distributor._id,
  status: "active",
});

if (!supplier) {
  return res.status(404).json({
    message: "No active supplier found for this distributor.",
  });
}

const supplierId = supplier._id;
  const {
    selectedBrand,
    selectedPlant,
    expectedDeliveryDate,
    remarks,
    orderRemark,
    status = "Confirmed",
    rows: rawRows,
  } = req.body;



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
  const rowsWithoutSoNumber = rows.length - Array.from(groups.values()).reduce((s, g) => s + g.length, 0);

  const results = [];

  for (const [soNumber, groupRows] of groups.entries()) {
    try {
      const saved = await createSinglePoFromGroup({
        soNumber,
        rows: groupRows,
        distributor,
        supplierId,
        selectedBrand,
        selectedPlant,
        expectedDeliveryDate,
        remarks,
        orderRemark,
        status,
        approvedStatus,
        approved_by,
      });

      results.push({
        soNumber,
        success: true,
        purchaseOrderId: saved._id,
        purchaseOrderNo: saved.purchaseOrderNo,
        totalLines: saved.totalLines,
        netAmount: saved.netAmount,
      });
    } catch (err) {
      results.push({
        soNumber,
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
    rowsWithoutSoNumberSkipped: rowsWithoutSoNumber,
    results,
  });
});

module.exports = { bulkCreatePurchaseOrders };