const mongoose = require("mongoose");
const PurchaseReturnNew = require("../../models/PurchasereturnNew.model");

// ------------------------------------------------------------
// Helpers — mirror the frontend calculation logic exactly (same
// as getBasicAmount / getApplicableTaxRate / getGSTAmount in
// PurchaseReturn.jsx), so Update behaves identically to Create.
//
// IMPORTANT: unlike the previous version, this does NOT re-fetch
// the Product model for mrp/l1BasicPercent/cgst/sgst/igst — those
// raw inputs are taken from the payload itself (same values the
// frontend already pulled from the populated product data via
// getPurchasProductListForReturn). We only recompute the DERIVED
// numbers (basicRate, taxableAmount, gstAmount, netAmount) here,
// so a client can't just send an arbitrary final netAmount, but
// we also don't silently zero everything out from a field-path
// mismatch against the raw Product schema.
// ------------------------------------------------------------

const round2 = (num) => Number((Number(num) || 0).toFixed(2));

// basicRate = mrp - (mrp * l1BasicPercent / 100)
const computeBasicRate = (mrp, l1BasicPercent) => {
  const m = Number(mrp) || 0;
  const percent = Number(l1BasicPercent) || 0;
  const discount = (m * percent) / 100;
  const basic = m - discount;
  return basic < 0 ? 0 : round2(basic);
};

// Applies the >=2500-per-unit GST-rate-bump rule (2.5->9 / 5->18),
// same as getApplicableTaxRate on the frontend.
const computeApplicableTaxRate = ({ cgst, sgst, igst, taxableAmount, returnQty }) => {
  let c = Number(cgst) || 0;
  let s = Number(sgst) || 0;
  let i = Number(igst) || 0;

  const qty = Number(returnQty) || 0;
  const pricePerUnit = qty > 0 ? Number(taxableAmount) / qty : 0;

  if (pricePerUnit >= 2500) {
    if (c === 2.5) c = 9;
    if (s === 2.5) s = 9;
    if (i === 5) i = 18;
  }

  return {
    cgstPercent: c > 0 ? c : 0,
    sgstPercent: s > 0 ? s : 0,
    igstPercent: i > 0 ? i : 0,
  };
};

// gstAmount uses cgst+sgst OR igst depending on isIGST, matching
// getGSTAmount on the frontend.
const computeGstAmount = ({ taxableAmount, cgstPercent, sgstPercent, igstPercent, isIGST }) => {
  const taxable = Number(taxableAmount) || 0;

  if (isIGST && igstPercent > 0) {
    return round2((taxable * igstPercent) / 100);
  }

  const totalPercent = (Number(cgstPercent) || 0) + (Number(sgstPercent) || 0);
  return totalPercent > 0 ? round2((taxable * totalPercent) / 100) : 0;
};

// Recomputes one line item's full pricing snapshot from the RAW
// inputs sent in the payload (mrp, l1BasicPercent, cgstPercent,
// sgstPercent, igstPercent, returnQty) — the same raw inputs the
// frontend derives from the product master data. Nothing here
// trusts the client's own basicRate/taxableAmount/gstAmount/
// netAmount — those are always recalculated fresh.
const buildLineItem = (rawItem, isIGST) => {
  const productId = rawItem?.productId;
  const returnQty = Number(rawItem?.returnQty);

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    throw { status: 400, message: "Invalid or missing productId in line items" };
  }
  if (!returnQty || returnQty <= 0) {
    throw { status: 400, message: `Return quantity must be greater than 0 for product ${productId}` };
  }
  if (returnQty % 1 !== 0) {
    throw { status: 400, message: `Return quantity for product ${productId} must be a whole number` };
  }

  const mrp = Number(rawItem?.mrp) || 0;
  const l1BasicPercent = Number(rawItem?.l1BasicPercent) || 0;
  const basicRate = computeBasicRate(mrp, l1BasicPercent);

  const taxableAmount = round2(basicRate * returnQty);

  const { cgstPercent, sgstPercent, igstPercent } = computeApplicableTaxRate({
    cgst: rawItem?.cgstPercent,
    sgst: rawItem?.sgstPercent,
    igst: rawItem?.igstPercent,
    taxableAmount,
    returnQty,
  });

  const gstAmount = computeGstAmount({
    taxableAmount,
    cgstPercent,
    sgstPercent,
    igstPercent,
    isIGST,
  });

  const netAmount = round2(taxableAmount + gstAmount);

  return {
    productId,
    returnQty,
    mrp,
    l1BasicPercent,
    basicRate,
    taxableAmount,
    cgstPercent,
    sgstPercent,
    igstPercent,
    gstAmount,
    netAmount,
  };
};

// ------------------------------------------------------------
// PATCH /edit-purchase-return-new/:purchaseReturnId
// Updates a Draft purchase return: godown, date, remark, and the
// full line item list (add/remove/qty-change all go through here,
// since the frontend always sends the complete edited list).
// ------------------------------------------------------------

exports.purchaseretunrEditNew = async (req, res) => {
  try {
    const { purchaseReturnId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(purchaseReturnId)) {
      return res.status(400).json({ success: false, message: "Invalid purchase return id" });
    }

    const existingReturn = await PurchaseReturnNew.findById(purchaseReturnId);
    if (!existingReturn) {
      return res.status(404).json({ success: false, message: "Purchase return not found" });
    }

    // Only Draft returns can be edited — once "Returned", stock has
    // already moved and the record should be immutable.
    if (existingReturn.status !== "Draft") {
      return res.status(400).json({
        success: false,
        message: "Only Draft purchase returns can be edited",
      });
    }

    const { godownId, returnDate, isIGST, returnRemark, lineItems } = req.body;

    if (!godownId || !mongoose.Types.ObjectId.isValid(godownId)) {
      return res.status(400).json({ success: false, message: "Please select a valid Godown" });
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ success: false, message: "Please add at least one product" });
    }

    // Recompute every line item's derived amounts from the raw
    // inputs sent in the payload.
    const builtLineItems = lineItems.map((raw) => buildLineItem(raw, Boolean(isIGST)));

    // Recompute header-level totals from the freshly built line items.
    const totalQty = builtLineItems.reduce((acc, i) => acc + i.returnQty, 0);
    const totalTaxableAmount = round2(
      builtLineItems.reduce((acc, i) => acc + i.taxableAmount, 0)
    );
    const totalGstAmount = round2(
      builtLineItems.reduce((acc, i) => acc + i.gstAmount, 0)
    );
    const totalAmount = round2(
      builtLineItems.reduce((acc, i) => acc + i.netAmount, 0)
    );

    existingReturn.godownId = godownId;
    existingReturn.returnDate = returnDate ? new Date(returnDate) : existingReturn.returnDate;
    existingReturn.isIGST = Boolean(isIGST);
    existingReturn.returnRemark = (returnRemark || "").trim().slice(0, 95);
    existingReturn.lineItems = builtLineItems;
    existingReturn.totalQty = totalQty;
    existingReturn.totalTaxableAmount = totalTaxableAmount;
    existingReturn.totalGstAmount = totalGstAmount;
    existingReturn.totalAmount = totalAmount;
    // status intentionally left as "Draft" — confirming/returning stock
    // stays a separate action via confirmPurchaseReturnNew.

    await existingReturn.save();

    return res.status(200).json({
      success: true,
      message: "Purchase return updated successfully",
      data: existingReturn,
    });
  } catch (error) {
    console.error("Error updating purchase return:", error);

    if (error?.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update purchase return",
    });
  }
};