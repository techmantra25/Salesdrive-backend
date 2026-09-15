const Invoice = require("../../models/invoice.model");
const Bill = require("../../models/bill.model");
const TransactionModel = require("../../models/transaction.model");
const SalesReturn = require("../../models/salesReturn.model");
const PurchaseReturn = require("../../models/purchaseReturn.model");
const OutletApproved = require("../../models/outletApproved.model");
const Product = require("../../models/product.model");
const State = require("../../models/state.model");
const ExcelJS = require("exceljs");
const moment = require("moment");

/**
 * Helper function to safely get nested object values
 */
const getNestedValue = (obj, path, defaultValue = "") => {
  try {
    return (
      path.split(".").reduce((current, key) => current?.[key], obj) ||
      defaultValue
    );
  } catch (error) {
    return defaultValue;
  }
};

/**
 * Helper function to format date
 */
const formatDate = (date) => {
  if (!date) return "";
  return moment(date).format("DD-MM-YYYY");
};

/**
 * Helper function to format currency
 */
const formatCurrency = (value) => {
  return parseFloat(value || 0).toFixed(2);
};

const formatRoundOff = (value) => {
  return Math.round(parseFloat(value || 0));
};

/**
 * Helper function to format a populated Godown doc for display, e.g.
 * "Main Godown (GDN01)". Used only for the new Godown column below.
 */
const formatGodown = (godownDoc) => {
  if (!godownDoc || typeof godownDoc !== "object") return "";
  const name = godownDoc.godownName || "";
  const code = godownDoc.godownCode || "";
  if (name && code) return `${name} (${code})`;
  return name || code || "";
};

/**
 * Helper function to calculate the LINE-ITEM GST percentage for
 * Purchase / Purchase Return, where there is no reliable stored product
 * GST field wired up the same way as Sales / Sales Return (see NOTE on
 * those blocks below). This back-derives the % from the recorded tax
 * rupee amounts, which is left exactly as before for these two types.
 */
const calculateGSTPercentage = (taxableAmount, totalTax) => {
  const taxable = parseFloat(taxableAmount || 0);
  const tax = parseFloat(totalTax || 0);
  return taxable > 0 ? ((tax / taxable) * 100).toFixed(2) : "0.00";
};

/**
 * NEW (Sales / Sales Return only): GST % read DIRECTLY off the product's
 * own stored cgst / sgst / igst fields, instead of being back-calculated
 * from the line item's rounded rupee tax amounts.
 *
 * Why: totalCGST / totalSGST on a line item are stored rounded to 2
 * decimals (e.g. 9% of 14.59 = 1.3131 -> stored as 1.31). Re-dividing
 * those rounded rupee figures back into a percentage reintroduces
 * rounding drift — e.g. (1.31 + 1.31) / 14.59 * 100 = 17.96%, even
 * though the product's actual rate is a clean 18.00% (cgst 9 + sgst 9).
 * The product's rate never changes, so read it straight from the
 * populated product doc instead.
 *
 * isInterstate decides which side of the product's rate to use:
 *   - interstate line item (carries IGST)      -> product.igst
 *   - intrastate line item (carries CGST+SGST) -> product.cgst + product.sgst
 */
const getProductGSTPercentage = (product, isInterstate) => {
  if (!product) return "0.00";
  if (isInterstate) {
    return parseFloat(product.igst || 0).toFixed(2);
  }
  return (
    parseFloat(product.cgst || 0) + parseFloat(product.sgst || 0)
  ).toFixed(2);
};

/**
 * Helper function to calculate the LINE-ITEM discount PERCENTAGE for the
 * Tally report's "Discount" column.
 *
 * IMPORTANT: `distributorDisc` on sales / salesReturn line items is stored
 * as a plain PERCENTAGE (e.g. 5, 10) whenever `distributorDiscUnit ===
 * "percent"`, and as a RUPEE AMOUNT whenever `distributorDiscUnit ===
 * "amount"`. `schemeDisc` has no unit field and is always a percentage.
 *
 * NOTE: This helper is still used for Purchase / Purchase Return below.
 * For Sales / Sales Return, the "Discount %" column now shows the line
 * item's own stored `totalDiscountPercentage` value directly (the final,
 * already-computed discount %) instead of being recalculated here — see
 * the Sales / Sales Return loops.
 *
 * For purchase / purchaseReturn, the schema has no percent field at all —
 * only rupee amounts (discountAmount, specialDiscountAmount) — so those
 * are still converted to a percentage of grossAmount, same as before.
 */
const calculateDiscountPercentage = (lineItem, type) => {
  if (type === "sales" || type === "salesReturn") {
    const grossAmount = parseFloat(lineItem.grossAmt || 0);

    // schemeDisc has no unit flag in the schema — always a percentage.
    const schemeDiscPercent = parseFloat(lineItem.schemeDisc || 0);

    const distDiscRaw = parseFloat(lineItem.distributorDisc || 0);
    const distDiscUnit = lineItem.distributorDiscUnit || "percent";

    // Only convert to % when it was actually stored as a rupee amount.
    const distDiscPercent =
      distDiscUnit === "amount"
        ? grossAmount > 0
          ? (distDiscRaw / grossAmount) * 100
          : 0
        : distDiscRaw; // already a percentage

    return (schemeDiscPercent + distDiscPercent).toFixed(2);
  }

  if (type === "purchase" || type === "purchaseReturn") {
    const grossAmount = parseFloat(
      lineItem.grossAmount || lineItem.grossAmt || 0,
    );
    const discountAmount =
      parseFloat(lineItem.discountAmount || 0) +
      parseFloat(lineItem.specialDiscountAmount || 0);

    return grossAmount > 0
      ? ((discountAmount / grossAmount) * 100).toFixed(2)
      : "0.00";
  }

  return "0.00";
};

/**
 * Flat GST rate applied to a document's combined Freight + Handling
 * charges, independent of the taxable-amount slab used for products in
 * calculateGSTPercentage(). e.g. charges of 100 -> GST amount of 18 -> total 118.
 * The report displays this RATE (18.00) in the "Charges GST %" column,
 * while the actual rupee gstAmount is still used internally to compute
 * totalWithGst / totalNetAmount, AND to top up each line item's own
 * CGST / SGST / IGST columns — see distributeChargesGst() below.
 */
const CHARGES_GST_RATE = 18;

/**
 * Computes the combined Freight + Handling charges for a SINGLE document
 * (Bill / SalesReturn) ONE TIME. The same result is then stamped onto
 * every line item belonging to that document, since charges are billed
 * once per order/bill, not per line item. Returns all zeros (never null)
 * when the document has no charges, so downstream columns simply show 0.
 */
const computeChargesForDoc = (doc) => {
  const chargesAmt =
    parseFloat(doc?.freightCharges || 0) + parseFloat(doc?.handlingCharges || 0);

  const gstAmount = chargesAmt > 0 ? (chargesAmt * CHARGES_GST_RATE) / 100 : 0;

  return {
    chargesAmt, // e.g. 100
    gstRate: chargesAmt > 0 ? CHARGES_GST_RATE : 0, // e.g. 18 (%) — displayed in report
    gstAmount, // e.g. 18 (rupees) — used internally for totals only
    totalWithGst: chargesAmt + gstAmount, // e.g. 118
  };
};

/**
 * Determines whether a line item is interstate (IGST) or intrastate
 * (CGST+SGST), based on the tax amounts ALREADY stored on the line item
 * itself — used consistently across GST %, Tax Amount, and the
 * Charges-GST split so all three agree on which side of the tax split
 * this particular line item is on.
 */
const isInterstateLineItem = (lineItem) => {
  const originalIgst = parseFloat(lineItem.totalIGST || lineItem.igst || 0);
  return originalIgst > 0;
};

/**
 * Sums the ORIGINAL (pre-charges-GST) tax amount — CGST + SGST + IGST —
 * across every line item belonging to a single document (Bill /
 * SalesReturn). This is used as the weight base so a document's Charges
 * GST can be split PROPORTIONALLY by each line item's own tax amount,
 * instead of splitting it equally across line items.
 */
const sumLineItemsTax = (lineItems) =>
  (lineItems || []).reduce((sum, li) => {
    const cgst = parseFloat(li.totalCGST || li.cgst || 0);
    const sgst = parseFloat(li.totalSGST || li.sgst || 0);
    const igst = parseFloat(li.totalIGST || li.igst || 0);
    return sum + cgst + sgst + igst;
  }, 0);

/**
 * Splits a document's total Charges-GST rupee amount across every line
 * item belonging to that document IN PROPORTION TO each line item's own
 * ORIGINAL tax amount (CGST+SGST+IGST), then routes each line item's
 * share into CGST+SGST (intrastate) or IGST (interstate) — matching
 * whichever tax type that specific line item already uses.
 *
 * Example: charges GST = 18, line item A has tax amount 200 and line
 * item B has tax amount 100 (document total tax = 300):
 *   - A's share = 18 * (200 / 300) = 12
 *   - B's share = 18 * (100 / 300) = 6
 *   - If A is intrastate (CGST/SGST): +6 to CGST, +6 to SGST.
 *   - If B is intrastate (CGST/SGST): +3 to CGST, +3 to SGST.
 *   - If either is interstate (IGST only): its full share goes to IGST.
 *
 * `totalDocTax` is the document-level sum from sumLineItemsTax() above,
 * computed once per document and passed in here for every line item so
 * all of them are weighted against the same total.
 *
 * Falls back to an EQUAL split across line items (the previous
 * behaviour) only when the document's total tax amount is 0 — e.g. every
 * line item is tax-free — to avoid a divide-by-zero.
 *
 * The returned cgst / sgst / igst are the FINAL, fully-loaded values —
 * they are what gets displayed in those columns AND what Tax Amount is
 * derived from, so the two can never drift apart.
 *
 * FIX (CGST must always equal SGST): previously cgst and sgst were each
 * computed independently —
 *   cgst = originalCgst + perItemChargesGst / 2
 *   sgst = originalSgst + perItemChargesGst / 2
 * Two things could make these diverge by a paisa even though GST rules
 * require CGST === SGST for any intrastate line item:
 *   1. originalCgst and originalSgst can already differ by a paisa,
 *      since they were rounded independently when the line item was
 *      first stored (e.g. 9% of 14.59 rounds to 1.31 on each side, but
 *      that rounding doesn't always land the same way for both).
 *   2. Even starting equal, formatCurrency() (toFixed(2)) rounds each
 *      one separately downstream, and floating-point division can push
 *      one up and the other down.
 * Fix: compute ONE combined intrastate tax figure (original CGST +
 * original SGST + this line's share of Charges GST) and split it in
 * half ONCE, assigning the exact same number to both cgst and sgst —
 * so they are bit-for-bit identical before formatting, not just close.
 */
const distributeChargesGst = (
  lineItem,
  chargesResult,
  lineItemCount,
  totalDocTax,
) => {
  const count = lineItemCount > 0 ? lineItemCount : 1;

  const originalCgst = parseFloat(lineItem.totalCGST || lineItem.cgst || 0);
  const originalSgst = parseFloat(lineItem.totalSGST || lineItem.sgst || 0);
  const originalIgst = parseFloat(lineItem.totalIGST || lineItem.igst || 0);

  // This line item's own original tax amount — the weight used for the
  // proportional split below.
  const lineItemTax = originalCgst + originalSgst + originalIgst;

  // Proportional share of the document's Charges GST, based on this line
  // item's own tax amount vs the document's total tax amount. Falls back
  // to an equal split across line items only when the document has no
  // tax at all (avoids dividing by zero).
  const perItemChargesGst =
    totalDocTax > 0
      ? (chargesResult.gstAmount * lineItemTax) / totalDocTax
      : chargesResult.gstAmount / count;

  // Interstate line item = one that already carries IGST; intrastate =
  // one that already carries CGST/SGST. Decided per line item so a mixed
  // bill (shouldn't normally happen, but just in case) still splits
  // correctly for each row.
  const isInterstate = isInterstateLineItem(lineItem);

  let cgst, sgst, igst;

  if (isInterstate) {
    cgst = originalCgst;
    sgst = originalSgst;
    igst = originalIgst + perItemChargesGst;
  } else {
    // Combine both intrastate sides into ONE figure, then split it in
    // half ONCE. cgst and sgst end up as the exact same JS number, so
    // formatCurrency() can never round them to two different strings.
    const combinedIntrastateTax =
      originalCgst + originalSgst + perItemChargesGst;
    const half = combinedIntrastateTax / 2;
    cgst = half;
    sgst = half;
    igst = originalIgst;
  }

  return { cgst, sgst, igst };
};

/**
 * Sums the netAmt of every line item belonging to a single document
 * (Bill / SalesReturn), so the "Total Net Amount" column can show the
 * TRUE document-level total (sum of all line items' net amounts, plus
 * the document's charges + charges GST) — not a value recomputed
 * per line item.
 */
const sumLineItemsNetAmt = (lineItems) =>
  (lineItems || []).reduce(
    (sum, li) => sum + parseFloat(li.netAmt || 0),
    0,
  );

exports.generateTallyReport = async (req, res) => {
  try {
    const { distributorId, startDate, endDate, transactionTypes, godownIds } =
      req.body;

    // Validate required fields
    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    // Build date filter
    //
    // FIX (date range only returning first day of range): the frontend
    // now always sends plain "YYYY-MM-DD" strings (see TallyReport.jsx),
    // so the regex fast-paths below are the ones that should normally
    // fire. But as defense-in-depth, the catch-all `else` branch (for
    // any ISO/Date-like string that slips through) now reads the
    // Y/M/D using UTC getters instead of LOCAL getters. Using local
    // getters is what caused the original bug: a Date serialized to
    // e.g. "2026-09-05T18:30:00.000Z" (IST midnight of the 6th,
    // converted to UTC) would have its calendar day silently pulled
    // back to the 5th if the Node process's local timezone was UTC —
    // getUTCDate() always reads the day embedded in the string itself,
    // regardless of server timezone, so it can't drift like that.
    const parseSelectedDate = (value, endOfDay = false) => {
      if (!value) return null;

      let year, month, day;

      const str = String(value).trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        [year, month, day] = str.split("-").map(Number);
      } else if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
        [day, month, year] = str.split("-").map(Number);
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
        [day, month, year] = str.split("/").map(Number);
      } else {
        const parsed = new Date(str);
        if (isNaN(parsed.getTime())) return null;

        // FIX: use UTC getters, not local getters, so the extracted
        // calendar date matches what's actually encoded in the string
        // regardless of the server's timezone configuration.
        year = parsed.getUTCFullYear();
        month = parsed.getUTCMonth() + 1;
        day = parsed.getUTCDate();
      }

      const utcMillis = Date.UTC(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0
      );

      // IST = UTC + 5:30
      return new Date(utcMillis - 5.5 * 60 * 60 * 1000);
    };

    const selectedStart = parseSelectedDate(startDate, false);
    const selectedEnd = parseSelectedDate(endDate, true);

    const dateFilter = {};

    if (selectedStart || selectedEnd) {
      dateFilter.createdAt = {};

      if (selectedStart) {
        dateFilter.createdAt.$gte = selectedStart;
      }

      if (selectedEnd) {
        dateFilter.createdAt.$lte = selectedEnd;
      }
    }

    const purchaseDateFilter = {};

    if (selectedStart || selectedEnd) {
      purchaseDateFilter.date = {};

      if (selectedStart) {
        purchaseDateFilter.date.$gte = selectedStart;
      }

      if (selectedEnd) {
        purchaseDateFilter.date.$lte = selectedEnd;
      }
    }

    // Build godown filter (Bill / SalesReturn / Invoice each carry a
    // godownId field directly). PurchaseReturn has no godownId of its own —
    // it's filtered separately below via its linked Invoice.
    const hasGodownFilter = Array.isArray(godownIds) && godownIds.length > 0;
    const godownFilter = hasGodownFilter
      ? { godownId: { $in: godownIds } }
      : {};

    // Prepare data containers
    const reportData = [];

    // Transaction types to include (default: all)
    const includeTypes = transactionTypes || [
      "sales",
      "salesReturn",
      "purchase",
      "purchaseReturn",
    ];

    // Fetch Sales data
    if (includeTypes.includes("sales")) {
      const bills = await Bill.find({
        distributorId,
        ...dateFilter,
        ...godownFilter,
      })
        .populate({
          path: "retailerId",
          select: "outletName gstin address1 pin",
          populate: {
            path: "stateId",
            select: "name",
          },
        })
        .populate(
          "lineItems.product",
          "name product_code product_hsn_code cgst sgst igst",
        )
        .populate("lineItems.price", "mrp_price sellingPrice")
        .populate("godownId", "godownName godownCode")
        .lean();

      for (const bill of bills) {
        // Computed ONCE per bill, then reused identically on every line
        // item pushed below — charges are the same for the whole bill.
        const chargesResult = computeChargesForDoc(bill);

        // BILL-LEVEL total: sum every line item's netAmt first, then add
        // the document's charges + charges GST ONCE. This is the value
        // shown in "Total Net Amount" on every row for this bill — it is
        // NOT recomputed per line item.
        const billNetAmtSum = sumLineItemsNetAmt(bill.lineItems);
        const billTotalNetAmount = billNetAmtSum + chargesResult.totalWithGst;

        // Divisor used only as the fallback equal-split when the bill's
        // total tax amount is 0 (see distributeChargesGst above).
        const lineItemCount = bill.lineItems.length;

        // Document-level total tax amount (CGST+SGST+IGST across every
        // line item), used as the weight base so each line item's share
        // of the bill's Charges GST is proportional to its OWN tax
        // amount instead of being split equally.
        const billTotalTax = sumLineItemsTax(bill.lineItems);

        for (let index = 0; index < bill.lineItems.length; index++) {
          const lineItem = bill.lineItems[index];

          // Skip 0-qty line items entirely — they don't show up in
          // the report at all.
          if (parseFloat(lineItem.billQty || 0) === 0) continue;

          // const roundOff = index === 0 ? bill.roundOffAmount || 0 : 0;

          // Unit Price = MRP of the product. The price sub-document stores
          // this as `mrp_price` (a string, e.g. "240"), NOT `mrp` — that
          // was the earlier bug causing this to always fall through to
          // the average-price fallback below. Falls back only if no MRP
          // was populated on the price doc at all.
          const mrpPrice =
            parseFloat(lineItem.price?.mrp_price || 0) ||
            (lineItem.billQty
              ? parseFloat(lineItem.grossAmt || 0) / lineItem.billQty
              : 0);

          // Item Value = MRP * Billed Qty (previously grossAmt).
          const itemValue = mrpPrice * (lineItem.billQty || 0);

          // Discount % = the line item's own final stored discount
          // percentage (not recalculated from scheme + distributor disc).
          const discountPercentage = parseFloat(
            lineItem.totalDiscountPercentage || 0,
          ).toFixed(2);

          // Is this line item interstate (IGST) or intrastate (CGST+SGST)?
          // Determined once and reused for GST %, Tax Amount, and the
          // Charges-GST split below, so all three columns stay consistent
          // with each other.
          const isInterstate = isInterstateLineItem(lineItem);

          // GST % comes directly from the PRODUCT's own stored
          // cgst/sgst/igst fields, not back-calculated from the line
          // item's rounded rupee tax amounts (that approach drifted —
          // e.g. 17.96% instead of the product's real 18.00%).
          const gstPercentage = getProductGSTPercentage(
            lineItem.product,
            isInterstate,
          );

          // CGST / SGST / IGST displayed values include this line
          // item's PROPORTIONAL share of the bill's Charges GST — based
          // on this line item's own tax amount vs the bill's total tax
          // amount (see distributeChargesGst). These are the FINAL
          // values used everywhere below — including Tax Amount — so
          // the two can never disagree. CGST and SGST are also now
          // guaranteed to be identical (see fix note on
          // distributeChargesGst above).
          const { cgst, sgst, igst } = distributeChargesGst(
            lineItem,
            chargesResult,
            lineItemCount,
            billTotalTax,
          );

          // FIX: Tax Amount = CGST + SGST for an intrastate line item,
          // OR IGST alone for an interstate line item. Derived from the
          // SAME final cgst/sgst/igst values shown in those columns
          // (i.e. INCLUDING each line item's proportional share of
          // Charges GST), so Tax Amount always equals what CGST+SGST
          // (or IGST) add up to on the row.
          const totalTax = isInterstate ? igst : cgst + sgst;

          reportData.push({
            transactionType: "Sales",
            // godown: formatGodown(bill.godownId),
            invoiceNo: bill.billNo || "",
            invoiceDate: formatDate(bill.createdAt),
            refDocNo: "Calcutta Metal Corporation",
            refDocDate: formatDate(bill.updatedAt),
            partyName: getNestedValue(bill, "retailerId.outletName", ""),
            gstin: getNestedValue(bill, "retailerId.gstin", ""),
            state: getNestedValue(bill, "retailerId.stateId.name", ""),
            address: getNestedValue(bill, "retailerId.address1", ""),
            address2: "",
            address3: "",
            address4: "",
            pin: getNestedValue(bill, "retailerId.pin", ""),
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.billQty || 0,
            price: formatCurrency(mrpPrice), // Unit Price = MRP
            grossAmount: formatCurrency(itemValue), // Item Value = MRP * Qty
            cgst: formatCurrency(cgst), // includes this line's proportional share of Charges GST
            sgst: formatCurrency(sgst), // includes this line's proportional share of Charges GST
            igst: formatCurrency(igst), // includes this line's proportional share of Charges GST
            taxAmount: formatCurrency(totalTax), // CGST+SGST or IGST, matches cgst/sgst/igst columns exactly
            discount: discountPercentage, // final line-item discount %
            taxableAmount: formatCurrency(lineItem.taxableAmt), // = SO Value
            netAmount: formatCurrency(lineItem.netAmt),
            // --- new columns ---
            // charges: same charges value repeated across every line item
            // belonging to this bill.
            charges: formatCurrency(chargesResult.chargesAmt),
            // chargesGst: a PERCENTAGE (e.g. 18.00), not a rupee
            // amount, repeated across every line item of this bill.
            chargesGst: chargesResult.gstRate.toFixed(2),
            // totalNetAmount: BILL-LEVEL total (sum of all line items'
            // netAmt + charges + charges GST amount), same on every row —
            // not recalculated per line item.
            totalNetAmount: Math.round(billTotalNetAmount),
          });
        }
      }
    }

    // Fetch Sales Return data
    if (includeTypes.includes("salesReturn")) {
      const salesReturns = await SalesReturn.find({
        distributorId,
        ...dateFilter,
        ...godownFilter,
      })
        .populate({
          path: "retailerId",
          select: "outletName gstin address1 pin",
          populate: {
            path: "stateId",
            select: "name",
          },
        })
        .populate(
          "lineItems.product",
          "name product_code product_hsn_code cgst sgst igst",
        )
        .populate("lineItems.price", "mrp_price sellingPrice")
        .populate("godownId", "godownName godownCode")
        .lean();

      for (const salesReturn of salesReturns) {
        // Computed ONCE per sales return, then reused identically on
        // every line item pushed below.
        const chargesResult = computeChargesForDoc(salesReturn);

        // DOCUMENT-LEVEL total: sum every line item's netAmt first, then
        // add charges + charges GST ONCE. Same on every row.
        const returnNetAmtSum = sumLineItemsNetAmt(salesReturn.lineItems);
        const returnTotalNetAmount =
          returnNetAmtSum + chargesResult.totalWithGst;

        // Divisor used only as the fallback equal-split when the sales
        // return's total tax amount is 0 (see distributeChargesGst above).
        const lineItemCount = salesReturn.lineItems.length;

        // Document-level total tax amount (CGST+SGST+IGST across every
        // line item), used as the weight base so each line item's share
        // of the sales return's Charges GST is proportional to its OWN
        // tax amount instead of being split equally.
        const returnTotalTax = sumLineItemsTax(salesReturn.lineItems);

        for (let index = 0; index < salesReturn.lineItems.length; index++) {
          const lineItem = salesReturn.lineItems[index];

          // Skip 0-qty line items entirely.
          if (parseFloat(lineItem.returnQty || 0) === 0) continue;

          const roundOff = index === 0 ? salesReturn.roundOffAmount || 0 : 0;

          // Unit Price = MRP of the product. Field is `mrp_price` on the
          // populated price sub-document, not `mrp` — see note in the
          // Sales loop above for why this matters.
          const mrpPrice =
            parseFloat(lineItem.price?.mrp_price || 0) ||
            (lineItem.returnQty
              ? parseFloat(lineItem.grossAmt || 0) / lineItem.returnQty
              : 0);

          // Item Value = MRP * Return Qty.
          const itemValue = mrpPrice * (lineItem.returnQty || 0);

          // Discount % = the line item's own final stored discount
          // percentage.
          const discountPercentage = parseFloat(
            lineItem.totalDiscountPercentage || 0,
          ).toFixed(2);

          // Is this line item interstate (IGST) or intrastate (CGST+SGST)?
          const isInterstate = isInterstateLineItem(lineItem);

          // GST % read directly from the PRODUCT's own stored
          // cgst/sgst/igst fields, same reasoning as the Sales loop above.
          const gstPercentage = getProductGSTPercentage(
            lineItem.product,
            isInterstate,
          );

          // CGST / SGST / IGST displayed values include this line
          // item's PROPORTIONAL share of the sales return's Charges GST
          // — based on this line item's own tax amount vs the sales
          // return's total tax amount. These are the FINAL values used
          // everywhere below — including Tax Amount — so the two can
          // never disagree. CGST and SGST are also now guaranteed to be
          // identical (see fix note on distributeChargesGst above).
          const { cgst, sgst, igst } = distributeChargesGst(
            lineItem,
            chargesResult,
            lineItemCount,
            returnTotalTax,
          );

          // FIX: Tax Amount = CGST + SGST (intrastate) OR IGST alone
          // (interstate), derived from the SAME final cgst/sgst/igst
          // values shown in those columns (i.e. INCLUDING each line
          // item's proportional share of Charges GST) — see note in the
          // Sales loop above for why this must be computed this way.
          const totalTax = isInterstate ? igst : cgst + sgst;

          reportData.push({
            transactionType: "Sales Return",
            godown: formatGodown(salesReturn.godownId),
            invoiceNo: salesReturn.salesReturnNo || "",
            invoiceDate: formatDate(salesReturn.createdAt),
            refDocNo: "Calcutta Metal Corporation",
            refDocDate: formatDate(salesReturn.updatedAt),
            partyName: getNestedValue(salesReturn, "retailerId.outletName", ""),
            gstin: getNestedValue(salesReturn, "retailerId.gstin", ""),
            state: getNestedValue(salesReturn, "retailerId.stateId.name", ""),
            address: getNestedValue(salesReturn, "retailerId.address1", ""),
            address2: "",
            address3: "",
            address4: "",
            pin: getNestedValue(salesReturn, "retailerId.pin", ""),
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.returnQty || 0,
            price: formatCurrency(mrpPrice), // Unit Price = MRP
            grossAmount: formatCurrency(itemValue), // Item Value = MRP * Qty
            cgst: formatCurrency(cgst), // includes this line's proportional share of Charges GST
            sgst: formatCurrency(sgst), // includes this line's proportional share of Charges GST
            igst: formatCurrency(igst), // includes this line's proportional share of Charges GST
            taxAmount: formatCurrency(totalTax), // CGST+SGST or IGST, matches cgst/sgst/igst columns exactly
            discount: discountPercentage, // final line-item discount %
            taxableAmount: formatCurrency(lineItem.taxableAmt), // = SO Value
            netAmount: formatCurrency(lineItem.netAmt),
            // --- new columns ---
            // charges: same charges value repeated across every line item
            // belonging to this sales return.
            charges: formatCurrency(chargesResult.chargesAmt),
            // chargesGst: PERCENTAGE (e.g. 18.00), not a rupee amount.
            chargesGst: chargesResult.gstRate.toFixed(2),
            // totalNetAmount: DOCUMENT-LEVEL total (sum of all line
            // items' netAmt + charges + charges GST amount), same on
            // every row.
            totalNetAmount: formatCurrency(returnTotalNetAmount),
          });
        }
      }
    }

    // Fetch Purchase data
    // NOTE: Left unchanged (still uses old back-calculated GST % logic
    // and old price/discount logic). The Invoice schema has no populated
    // product doc with reliable cgst/sgst/igst wired the same way as
    // Sales / Sales Return above, and no stored totalDiscountPercentage
    // field, so the product-GST% / MRP / final-discount-% treatment
    // applied to Sales / Sales Return does not carry over here without
    // further schema-level changes. Purchase has no Freight/Handling
    // charges concept applied here, so charges / chargesGst are 0 and
    // totalNetAmount stays the line item's own netAmount (no
    // document-level charges to add in). No charges-GST to split here
    // either, since there are no charges. Its Tax Amount is therefore
    // already consistent with cgst+sgst / igst (both come straight from
    // the line item's own stored fields with nothing added on top).
    if (includeTypes.includes("purchase")) {
      const invoices = await Invoice.find({
        distributorId,
        ...purchaseDateFilter,
        ...godownFilter,
      })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate("godownId", "godownName godownCode")
        .lean();

      for (const invoice of invoices) {
        for (let index = 0; index < invoice.lineItems.length; index++) {
          const lineItem = invoice.lineItems[index];

          // Skip 0-qty line items entirely.
          const purchaseQty = parseFloat(
            lineItem.receivedQty || lineItem.qty || 0,
          );
          if (purchaseQty === 0) continue;

          const discountPercentage = calculateDiscountPercentage(
            lineItem,
            "purchase",
          );
          const roundOff = index === 0 ? invoice.roundOff || 0 : 0;
          // Calculate GST percentage (unchanged for Purchase — see NOTE above)
          const taxableAmount = parseFloat(lineItem.grossAmount || 0);
          const totalTax =
            parseFloat(lineItem.cgst || 0) +
            parseFloat(lineItem.sgst || 0) +
            parseFloat(lineItem.igst || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Purchase",
            godown: formatGodown(invoice.godownId),
            invoiceNo: invoice.invoiceNo || "",
            invoiceDate: formatDate(invoice.date || invoice.createdAt),
            refDocNo: "Calcutta Metal Corporation",
            refDocDate: formatDate(invoice.date || invoice.updatedAt),
            partyName: "Infrawal Projects Pvt Ltd",
            gstin: invoice.supplierGSTIN || "",
            state: invoice.supplierState || "",
            address: invoice.supplieraddress1 || "",
            address2: "",
            address3: "",
            address4: "",
            pin: "",
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.receivedQty || lineItem.qty || 0,
            price: formatCurrency(
              lineItem.mrp || lineItem.taxableAmount / lineItem.qty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmount),
            cgst: formatCurrency(lineItem.cgst),
            sgst: formatCurrency(lineItem.sgst),
            igst: formatCurrency(lineItem.igst),
            taxAmount: formatCurrency(totalTax),
            discount: discountPercentage,
            taxableAmount: formatCurrency(lineItem.taxableAmount),
            netAmount: formatCurrency(lineItem.netAmount),
            // Purchase has no Freight/Handling charges concept applied
            // here, so these new columns are simply 0 for this type.
            charges: formatCurrency(0),
            chargesGst: (0).toFixed(2), // percentage, 0 when no charges
            totalNetAmount: formatCurrency(lineItem.netAmount),
          });
        }
      }
    }

    // Fetch Purchase Return data
    // NOTE: Left unchanged, same reasoning as Purchase above. No charges
    // GST to split here either, so Tax Amount already matches cgst+sgst
    // / igst as-is.
    if (includeTypes.includes("purchaseReturn")) {
      let purchaseReturns = await PurchaseReturn.find({
        distributorId,
        ...dateFilter,
      })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate({
          path: "invoiceId",
          select: "invoiceNo supplierName godownId",
          populate: {
            path: "godownId",
            select: "godownName godownCode",
          },
        })
        .lean();

      // PurchaseReturn has no godownId of its own — it only reaches a
      // godown through the Invoice it's linked to, so filter in-memory
      // after populate rather than in the Mongo query.
      if (hasGodownFilter) {
        const allowed = new Set(godownIds.map(String));
        purchaseReturns = purchaseReturns.filter((pr) => {
          const gid = pr.invoiceId?.godownId?._id || pr.invoiceId?.godownId;
          return gid && allowed.has(String(gid));
        });
      }

      for (const purchaseReturn of purchaseReturns) {
        for (let index = 0; index < purchaseReturn.lineItems.length; index++) {
          const lineItem = purchaseReturn.lineItems[index];

          // Skip 0-qty line items entirely.
          if (parseFloat(lineItem.returnQty || 0) === 0) continue;

          const discountPercentage = calculateDiscountPercentage(
            lineItem,
            "purchaseReturn",
          );
          const roundOff = index === 0 ? purchaseReturn.roundOff || 0 : 0;
          // Calculate GST percentage (unchanged for Purchase Return — see NOTE above)
          const taxableAmount = parseFloat(lineItem.grossAmt || 0);
          const totalTax =
            parseFloat(lineItem.cgst || 0) +
            parseFloat(lineItem.sgst || 0) +
            parseFloat(lineItem.igst || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Purchase Return",
            godown: formatGodown(purchaseReturn.invoiceId?.godownId),
            invoiceNo: purchaseReturn.code || "",
            invoiceDate: formatDate(purchaseReturn.createdAt),
            refDocNo: "Calcutta Metal Corporation",
            refDocDate: formatDate(purchaseReturn.updatedAt),
            partyName: "Infrawal Projects Pvt Ltd",
            gstin: "",
            state: "",
            address: "",
            address2: "",
            address3: "",
            address4: "",
            pin: "",
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.returnQty || 0,
            price: formatCurrency(
              lineItem.mrp || lineItem.grossAmt / lineItem.returnQty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmt),
            cgst: formatCurrency(lineItem.cgst),
            sgst: formatCurrency(lineItem.sgst),
            igst: formatCurrency(lineItem.igst),
            taxAmount: formatCurrency(totalTax),
            discount: discountPercentage,
            taxableAmount: formatCurrency(lineItem.taxableAmt),
            netAmount: formatCurrency(lineItem.netAmt),
            // Purchase Return has no Freight/Handling charges concept
            // applied here, so these new columns are simply 0.
            charges: formatCurrency(0),
            chargesGst: (0).toFixed(2), // percentage, 0 when no charges
            totalNetAmount: formatCurrency(lineItem.netAmt),
          });
        }
      }
    }

    // Generate Excel file
    const filePath = await generateExcelReport(reportData, distributorId);
    reportData.sort((a, b) => {
      const parseReportDate = (value) => {
        if (!value) return Number.MAX_SAFE_INTEGER;

        const parts = String(value).split("-");
        if (parts.length !== 3) return Number.MAX_SAFE_INTEGER;

        const [day, month, year] = parts.map(Number);

        return new Date(year, month - 1, day).getTime();
      };

      return parseReportDate(a.invoiceDate) - parseReportDate(b.invoiceDate);
    });

    // Send file
    res.download(
      filePath,
      `Tally_Report_${moment().format("YYYYMMDD_HHmmss")}.xlsx`,
      (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          return res.status(500).json({
            success: false,
            message: "Error downloading file",
          });
        }

        // Clean up file after sending
        const fs = require("fs");
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error("Error deleting temp file:", unlinkErr);
        });
      },
    );
  } catch (error) {
    console.error("Error generating Tally report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating Tally report",
      error: error.message,
    });
  }
};

/**
 * Generate Excel file from report data
 */
const generateExcelReport = async (reportData, distributorId) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Tally Master Sheet");

  // Define columns based on the sample format.
  // All original headers/keys are unchanged. Three new columns are
  // appended at the end for the per-document Freight + Handling charges.
  // NOTE: "Charges GST" is a PERCENTAGE column (e.g. 18.00), not a
  // rupee amount — header updated to "Charges GST %" to reflect that.
  worksheet.columns = [
    { header: "Transaction Type", key: "transactionType", width: 18 },
    // { header: "Godown", key: "godown", width: 20 },
    { header: "Invoice No", key: "invoiceNo", width: 15 },
    { header: "Invoice Date", key: "invoiceDate", width: 20 },
    { header: "Ref Doc No", key: "refDocNo", width: 15 },
    { header: "Ref Date", key: "refDocDate", width: 20 },
    { header: "Party Name", key: "partyName", width: 30 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "STATE CODE", key: "state", width: 15 },
    { header: "Address1", key: "address", width: 30 },
    { header: "Address2", key: "address2", width: 30 },
    { header: "Address3", key: "address3", width: 30 },
    { header: "Address4", key: "address4", width: 30 },
    { header: "Pin Code", key: "pin", width: 10 },
    { header: "Item Name", key: "productName", width: 25 },
    { header: "Product Description", key: "description", width: 30 },
    { header: "HSN No", key: "hsnNo", width: 12 },
    { header: "Unit", key: "uom", width: 12 },
    { header: "GST Per", key: "gst", width: 10 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Unit Price", key: "price", width: 12 },
    { header: "Item Value", key: "grossAmount", width: 15 },
    { header: "Discount %", key: "discount", width: 12 },
    { header: "Taxable Amount", key: "taxableAmount", width: 15 },
    { header: "CGST", key: "cgst", width: 12 },
    { header: "SGST", key: "sgst", width: 12 },
    { header: "IGST", key: "igst", width: 12 },
    { header: "Tax Amount", key: "taxAmount", width: 12 },
    { header: "Net Amount", key: "netAmount", width: 15 },
    // --- new columns (charges are same for every line item of a
    // given order/bill; 0 when the document has no charges) ---
    { header: "Freight & Delivery Charges & Handling Fee)", key: "charges", width: 20 },
    { header: "Charges GST %", key: "chargesGst", width: 14 },
    { header: "Total Net Amount (Inc. GST)", key: "totalNetAmount", width: 18 },
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, size: 11, name: "Arial" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 20;

  // Add data rows
  reportData.forEach((data) => {
    worksheet.addRow(data);
  });

  // Apply formatting to all data rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.font = { size: 10, name: "Arial" };
      row.alignment = { vertical: "middle" };

      // Format numeric (currency) columns — "discount" and "chargesGst"
      // intentionally excluded here since they're percentages, not
      // rupee amounts; they're formatted separately below alongside the
      // GST % column.
      [
        "qty",
        "price",
        "grossAmount",
        "taxAmount",
        "cgst",
        "sgst",
        "igst",
        "netAmount",
        "taxableAmount",
        "charges",
        "totalNetAmount",
      ].forEach((key) => {
        const cell = row.getCell(key);
        cell.numFmt = "#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      });

      // Format GST percentage column
      const gstCell = row.getCell("gst");
      gstCell.numFmt = "0.00";
      gstCell.alignment = { vertical: "middle", horizontal: "right" };

      // Format Discount percentage column
      const discountCell = row.getCell("discount");
      discountCell.numFmt = "0.00";
      discountCell.alignment = { vertical: "middle", horizontal: "right" };

      // Format Charges GST percentage column (this is a %, not a rupee value)
      const chargesGstCell = row.getCell("chargesGst");
      chargesGstCell.numFmt = "0.00";
      chargesGstCell.alignment = { vertical: "middle", horizontal: "right" };

      // Center align specific columns
      ["transactionType", "uom"].forEach((key) => {
        const cell = row.getCell(key);
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }
  });

  // Add borders to all cells
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  // Auto-filter across the FULL column range. The sheet now has 31
  // columns (past column Z), so a fixed "to: Z1" would drop the last
  // three (Charges / Charges GST % / Total Net Amount) from the filter.
  // Computed dynamically from the actual column count instead.
  const lastColumnLetter = worksheet.getColumn(
    worksheet.columns.length,
  ).letter;
  worksheet.autoFilter = {
    from: "A1",
    to: `${lastColumnLetter}1`,
  };

  // Freeze header row
  worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  // Save file
  const fs = require("fs");
  const path = require("path");
  const tempDir = path.join(__dirname, "../../temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(
    tempDir,
    `Tally_Report_${distributorId}_${Date.now()}.xlsx`,
  );
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

/**
 * Get Tally Report Summary
 * @route GET /api/tally/summary
 * @access Private
 */
exports.getTallyReportSummary = async (req, res) => {
  try {
    const { distributorId, startDate, endDate } = req.query;

    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get counts and totals
    const [salesCount, salesReturnCount, purchaseCount, purchaseReturnCount] =
      await Promise.all([
        Bill.countDocuments({ distributorId, ...dateFilter }),
        SalesReturn.countDocuments({ distributorId, ...dateFilter }),
        Invoice.countDocuments({ distributorId, ...dateFilter }),
        PurchaseReturn.countDocuments({ distributorId, ...dateFilter }),
      ]);

    // Get total amounts
    const [salesTotal, salesReturnTotal, purchaseTotal, purchaseReturnTotal] =
      await Promise.all([
        Bill.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
        SalesReturn.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
        Invoice.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$totalInvoiceAmount" } } },
        ]),
        PurchaseReturn.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
      ]);

    res.status(200).json({
      success: true,
      data: {
        sales: {
          count: salesCount,
          total: salesTotal[0]?.total || 0,
        },
        salesReturn: {
          count: salesReturnCount,
          total: salesReturnTotal[0]?.total || 0,
        },
        purchase: {
          count: purchaseCount,
          total: purchaseTotal[0]?.total || 0,
        },
        purchaseReturn: {
          count: purchaseReturnCount,
          total: purchaseReturnTotal[0]?.total || 0,
        },
        netSales:
          (salesTotal[0]?.total || 0) - (salesReturnTotal[0]?.total || 0),
        netPurchase:
          (purchaseTotal[0]?.total || 0) - (purchaseReturnTotal[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error("Error getting Tally report summary:", error);
    res.status(500).json({
      success: false,
      message: "Error getting report summary",
      error: error.message,
    });
  }
};

/**
 * Get Inventory Transactions for Tally
 * @route GET /api/tally/inventory-transactions
 * @access Private
 */
exports.getInventoryTransactions = async (req, res) => {
  try {
    const { distributorId, startDate, endDate, productId, transactionType } =
      req.query;

    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    const filter = { distributorId };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    if (productId) {
      filter.productId = productId;
    }

    if (transactionType) {
      filter.transactionType = transactionType;
    }

    const transactions = await TransactionModel.find(filter)
      .populate("productId", "name product_code product_hsn_code")
      .sort({ date: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Error getting inventory transactions:", error);
    res.status(500).json({
      success: false,
      message: "Error getting inventory transactions",
      error: error.message,
    });
  }
};

module.exports = exports;