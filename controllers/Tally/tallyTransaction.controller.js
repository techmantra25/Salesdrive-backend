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
 * Helper function to calculate the LINE-ITEM GST percentage.
 *
 * IMPORTANT: This previously guessed a slab (<=2500 -> 5%, >2500 -> 18%)
 * instead of using the actual tax recorded on the line item, and was also
 * being fed `grossAmt` as the "taxable amount" instead of the real
 * `taxableAmt` — both wrong. The correct rate is always derivable
 * directly from the line item's own stored tax amounts:
 *   GST % = (CGST + SGST + IGST) / taxableAmt * 100
 * e.g. CGST 113.27 + SGST 113.27 = 226.54 over taxableAmt 1258.56 = 18.00%,
 * which matches the product's own cgst(9%) + sgst(9%) fields.
 */
const calculateGSTPercentage = (taxableAmount, totalTax) => {
  const taxable = parseFloat(taxableAmount || 0);
  const tax = parseFloat(totalTax || 0);
  return taxable > 0 ? ((tax / taxable) * 100).toFixed(2) : "0.00";
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
 * totalWithGst / totalNetAmount.
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
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
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
        .populate("lineItems.product", "name product_code product_hsn_code")
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

        for (let index = 0; index < bill.lineItems.length; index++) {
          const lineItem = bill.lineItems[index];

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

          // Calculate the real GST % from actual tax amounts recorded on
          // the line item — must use taxableAmt (the correct base), not
          // grossAmt.
          const totalTax =
            parseFloat(lineItem.totalCGST || 0) +
            parseFloat(lineItem.totalSGST || 0) +
            parseFloat(lineItem.totalIGST || 0);
          const gstPercentage = calculateGSTPercentage(
            lineItem.taxableAmt,
            totalTax,
          );

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
            cgst: formatCurrency(lineItem.totalCGST),
            sgst: formatCurrency(lineItem.totalSGST),
            igst: formatCurrency(lineItem.totalIGST),
            taxAmount: formatCurrency(totalTax),
            discount: discountPercentage, // final line-item discount %
            taxableAmount: formatCurrency(lineItem.taxableAmt), // = SO Value
            netAmount: formatCurrency(lineItem.netAmt),
            // --- new columns ---
            // charges: same charges value repeated across every line item
            // belonging to this bill.
            charges: formatCurrency(chargesResult.chargesAmt),
            // chargesGst: now a PERCENTAGE (e.g. 18.00), not a rupee
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
        .populate("lineItems.product", "name product_code product_hsn_code")
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

        for (let index = 0; index < salesReturn.lineItems.length; index++) {
          const lineItem = salesReturn.lineItems[index];

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

          // Calculate GST percentage
          const taxableAmount = parseFloat(lineItem.grossAmt || 0);
          const totalTax =
            parseFloat(lineItem.totalCGST || 0) +
            parseFloat(lineItem.totalSGST || 0) +
            parseFloat(lineItem.totalIGST || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

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
            cgst: formatCurrency(lineItem.totalCGST),
            sgst: formatCurrency(lineItem.totalSGST),
            igst: formatCurrency(lineItem.totalIGST),
            taxAmount: formatCurrency(totalTax),
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
    // NOTE: Left unchanged (still uses old price/discount logic). The
    // Invoice schema has no populated price.mrp reference and no stored
    // totalDiscountPercentage field, so the MRP / final-discount-%
    // treatment applied to Sales / Sales Return above does not carry
    // over here without further schema-level changes. Purchase has no
    // Freight/Handling charges concept applied here, so charges /
    // chargesGst are 0 and totalNetAmount stays the line item's own
    // netAmount (no document-level charges to add in).
    if (includeTypes.includes("purchase")) {
      const invoices = await Invoice.find({
        distributorId,
        ...dateFilter,
        ...godownFilter,
      })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate("godownId", "godownName godownCode")
        .lean();

      for (const invoice of invoices) {
        for (let index = 0; index < invoice.lineItems.length; index++) {
          const lineItem = invoice.lineItems[index];

          const discountPercentage = calculateDiscountPercentage(
            lineItem,
            "purchase",
          );
          const roundOff = index === 0 ? invoice.roundOff || 0 : 0;
          // Calculate GST percentage
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
    // NOTE: Left unchanged, same reasoning as Purchase above.
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

          const discountPercentage = calculateDiscountPercentage(
            lineItem,
            "purchaseReturn",
          );
          const roundOff = index === 0 ? purchaseReturn.roundOff || 0 : 0;
          // Calculate GST percentage
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
  // NOTE: "Charges GST" is now a PERCENTAGE column (e.g. 18.00), not a
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

      // Format Charges GST percentage column (now a %, not a rupee value)
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