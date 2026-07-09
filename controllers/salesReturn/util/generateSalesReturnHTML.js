const numberToWords = require("../../bill/util/numberToWords");

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const formatCurrency = (amount) => {
  const value = Number(amount);
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
};

const formatAmountInWords = (amount) => {
  const value = Math.round(Number(amount) || 0);
  if (!value) return "Zero Rupees Only";
  return `${numberToWords(value)} Rupees Only`;
};

const generateSalesReturnHTML = (salesReturn, options = {}) => {
  const distributor = salesReturn.distributorId || {};
  const outlet = salesReturn.retailerId || {};
  const route = salesReturn.routeId || {};
  const bill = salesReturn.billId;
  const bank = salesReturn.bankData || {};
  const termConditions = salesReturn.termConditions || [];

  const validLineItems = (salesReturn?.lineItems || []).filter((item) => item?.returnQty > 0);

  const creditNoteItems = validLineItems.filter((i) => i.salesReturnType === "Credit Note");
  const replacementItems = validLineItems.filter((i) => i.salesReturnType === "Replacement");
  const noCreditItems = validLineItems.filter((i) => i.salesReturnType === "No Credit Note");

  const daysSinceBill =
    bill?.createdAt && salesReturn?.createdAt
      ? Math.floor((new Date(salesReturn.createdAt) - new Date(bill.createdAt)) / (1000 * 60 * 60 * 24))
      : 0;

  const MIN_ROWS = 15;
  const blankRowsNeeded = Math.max(0, MIN_ROWS - validLineItems.length);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sales Return - ${escapeHtml(salesReturn.salesReturnNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 9.5px;
      line-height: 1.3;
      color: #000;
      background: #fff;
    }
    .document-container {
      border: 1px solid #000;
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      background: #fff;
    }
    table { width: 100%; border-collapse: collapse; }
    .details-table td, .summary-table td { vertical-align: top; padding: 2px 4px; }
    .left-section { width: 50%; border-right: 1px solid #000; padding: 4px 6px; }
    .right-section { width: 50%; padding: 4px 6px; }
    .items-table th {
      border-right: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 2px;
      text-align: center;
      font-weight: bold;
      background: #f5f5f5;
      font-size: 8.5px;
    }
    .items-table td {
      border-right: 1px solid #000;
      border-bottom: 1px solid #eee;
      padding: 2px 3px;
      font-size: 8.5px;
    }
    .items-table th:last-child, .items-table td:last-child { border-right: none; }
    .items-table { border-bottom: 1px solid #000; }
    .details-table, .summary-table { border-bottom: 1px solid #000; }
    .terms-section { padding: 4px 6px; border-bottom: 1px solid #000; }
    .terms-section ol { margin: 2px 0 0 16px; padding: 0; }
    .border-top-bold { border-top: 2px solid #000; }
    .text-left { text-align: left; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .signature-line {
      border-top: 1px solid #000;
      width: 180px;
      margin: 40px auto 0 auto;
      padding-top: 4px;
      text-align: center;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-btn, .close-btn { display: none !important; }
    }
  </style>
</head>
<body>
<div class="document-container">

  <!-- HEADER -->
  <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 12px; border-bottom:1px solid #000;">
    <div style="flex:0 0 100px; height:100px; display:flex; align-items:center; justify-content:center;">
      ${
        options?.logoBase64
          ? `<img src="${escapeHtml(options.logoBase64)}" alt="Company Logo" style="width:100%; height:100%; object-fit:contain; display:block;" onerror="this.style.display='none'" />`
          : `<div style="width:100px;height:100px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa;">Logo</div>`
      }
    </div>
    <div style="flex:1; text-align:right; padding-left:8px;">
      <div style="font-size:20px; font-weight:bold; letter-spacing:0.5px;">${escapeHtml(distributor?.name || "Company Name")}</div>
      ${distributor?.address1 ? `<div style="font-size:9px; margin-top:2px;">${escapeHtml(distributor.address1)}${distributor?.address2 ? `, ${escapeHtml(distributor.address2)}` : ""}</div>` : ""}
      <div style="font-size:9px; margin-top:1px;">
        ${distributor?.email ? `Email : ${escapeHtml(distributor.email)}` : ""}${distributor?.email && distributor?.phone ? ", " : ""}${distributor?.phone ? `Phone : ${escapeHtml(distributor.phone)}` : ""}
      </div>
      ${distributor?.gst_no || distributor?.stateId?.name ? `<div style="font-size:9px; margin-top:1px;">${distributor?.gst_no ? `GSTIN: <strong>${escapeHtml(distributor.gst_no)}</strong>` : ""}${distributor?.gst_no && distributor?.stateId?.name ? " &nbsp;&nbsp; " : ""}${distributor?.stateId?.name ? `State: ${escapeHtml(distributor.stateId.name)}` : ""}</div>` : ""}
    </div>
  </div>

  <!-- TITLE -->
  <div style="text-align:center; padding:3px 0; border-bottom:1px solid #000; background:#fff5f5;">
    <span style="font-size:11px; font-weight:bold; letter-spacing:2px; color:#d32f2f; text-decoration:underline;">SALES RETURN</span>
  </div>

  <!-- RETAILER + RETURN DETAILS -->
  <table class="details-table">
    <tbody>
      <tr>
        <td class="left-section">
          <table>
            <tbody>
              <tr><td colspan="2" class="bold" style="font-size:9px;">Retailer Details</td></tr>
              <tr>
                <td style="width:35%; font-size:9px;">Name</td>
                <td style="font-size:9px;">: <strong>${escapeHtml(outlet?.outletName || "")}${outlet?.outletUID ? ` (${escapeHtml(outlet.outletUID)})` : ""}</strong></td>
              </tr>
              <tr>
                <td style="font-size:9px;">Address</td>
                <td style="font-size:9px;">: ${escapeHtml(outlet?.address1 || "")}${outlet?.city ? `, ${escapeHtml(outlet.city)}` : ""}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Pin Code</td>
                <td style="font-size:9px;">: ${escapeHtml(outlet?.pin || "")}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Phone No.</td>
                <td style="font-size:9px;">: <strong>${escapeHtml(outlet?.mobile1 || "")}</strong></td>
              </tr>
              <tr>
                <td style="font-size:9px;">GSTIN No.</td>
                <td style="font-size:9px;">: <strong>${escapeHtml(outlet?.gstin || "")}</strong></td>
              </tr>
            </tbody>
          </table>
        </td>
        <td class="right-section">
          <table>
            <tbody>
              <tr><td colspan="2" class="bold" style="font-size:9px;">Sales Return Details</td></tr>
              <tr>
                <td style="width:40%; font-size:9px;">Sales Return No.</td>
                <td style="font-size:9px;">: <strong>${escapeHtml(salesReturn.salesReturnNo)}</strong></td>
              </tr>
              <tr>
                <td style="font-size:9px;">Return Date</td>
                <td style="font-size:9px;">: ${escapeHtml(formatDate(salesReturn.createdAt))}</td>
              </tr>
              ${bill ? `
              <tr>
                <td style="font-size:9px;">Reference Bill No.</td>
                <td style="font-size:9px;">: ${escapeHtml(bill?.billNo || "")}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Bill Date</td>
                <td style="font-size:9px;">: ${escapeHtml(formatDate(bill?.createdAt))}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Days Since Bill</td>
                <td style="font-size:9px;">: ${daysSinceBill} days ${daysSinceBill > 90 ? "(Exceeds 90)" : "(Max 90)"}</td>
              </tr>` : ""}
              <tr>
                <td style="font-size:9px;">Route</td>
                <td style="font-size:9px;">: ${escapeHtml(route?.beat_name || route?.name || "")}${route?.code ? ` (${escapeHtml(route.code)})` : ""}</td>
              </tr>
              ${salesReturn.goodsType ? `
              <tr>
                <td style="font-size:9px;">Goods Type</td>
                <td style="font-size:9px;">: ${escapeHtml(salesReturn.goodsType)}</td>
              </tr>` : ""}
              ${salesReturn.collectionStatus ? `
              <tr>
                <td style="font-size:9px;">Collection Status</td>
                <td style="font-size:9px;">: ${escapeHtml(salesReturn.collectionStatus)}</td>
              </tr>` : ""}
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  ${salesReturn.remarks ? `
  <div style="background:#fff9e6; border-left:4px solid #ff9800; padding:4px 8px; font-size:8.5px;">
    <strong>Remarks:</strong> ${escapeHtml(salesReturn.remarks)}
  </div>` : ""}

  <!-- LINE ITEMS TABLE -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:4%;">Sr.<br/>No.</th>
        <th style="width:22%; text-align:left;">Item Description</th>
        <th style="width:6%;">HSN</th>
        <th style="width:6%;">UOM</th>
        <th style="width:7%;">Bill<br/>Qty</th>
        <th style="width:7%;">Return<br/>Qty</th>
        <th style="width:9%;">Basic Rate</th>
        <th style="width:9%;">Gross Amt</th>
        <th style="width:8%;">Scheme<br/>Disc</th>
        <th style="width:9%;">Taxable<br/>Amt</th>
        <th style="width:8%;">TAX Amt</th>
        <th style="width:9%;">Net Amt</th>
      </tr>
    </thead>
    <tbody>
      ${validLineItems.map((item, index) => {
        const product = item.product || {};
        return `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td class="text-left">${escapeHtml(product.name || "")}</td>
        <td class="text-center">${escapeHtml(product.product_hsn_code || "")}</td>
        <td class="text-center">${escapeHtml((item.uom || "").toUpperCase())}</td>
        <td class="text-center">${item.billQty || 0}</td>
        <td class="text-center">${item.returnQty || 0}</td>
        <td class="text-right">&#8377;${formatCurrency(item.price?.rlp_price || 0)}</td>
        <td class="text-right">&#8377;${formatCurrency(item.grossAmt)}</td>
        <td class="text-right">&#8377;${formatCurrency(item.schemeDisc)}</td>
        <td class="text-right">&#8377;${formatCurrency(item.taxableAmt)}</td>
        <td class="text-right">&#8377;${formatCurrency((Number(item.totalCGST) || 0) + (Number(item.totalSGST) || 0) + (Number(item.totalIGST) || 0))}</td>
        <td class="text-right">&#8377;${formatCurrency(item.netAmt)}</td>
      </tr>`;
      }).join("")}
      ${Array.from({ length: blankRowsNeeded }).map(() => `
      <tr>
        <td class="text-center">-</td>
        <td></td><td></td><td></td><td></td><td></td>
        <td></td><td></td><td></td><td></td><td></td><td></td>
      </tr>`).join("")}
    </tbody>
  </table>

  <!-- SUMMARY -->
  <table class="summary-table">
    <tbody>
      <tr>
        <td class="left-section">
          <table>
            <tbody>
              <tr><td colspan="3" class="bold" style="font-size:9px;">E &amp; O.E</td></tr>
              <tr>
                <td colspan="2" style="font-size:9px;">Total Items Returned</td>
                <td style="font-size:9px;">: ${validLineItems.length}</td>
              </tr>
              <tr>
                <td colspan="2" style="font-size:9px;">Total Return Qty (PCS)</td>
                <td style="font-size:9px;">: ${validLineItems.reduce((s, i) => s + (i.returnQty || 0), 0)}</td>
              </tr>
              ${creditNoteItems.length > 0 ? `<tr><td colspan="2" style="font-size:9px;">Items for Credit Note</td><td style="font-size:9px;">: ${creditNoteItems.length}</td></tr>` : ""}
              ${replacementItems.length > 0 ? `<tr><td colspan="2" style="font-size:9px;">Items for Replacement</td><td style="font-size:9px;">: ${replacementItems.length}</td></tr>` : ""}
              ${noCreditItems.length > 0 ? `<tr><td colspan="2" style="font-size:9px;">Items - No Credit</td><td style="font-size:9px;">: ${noCreditItems.length}</td></tr>` : ""}
              ${salesReturn.totalBasePoints > 0 ? `<tr><td colspan="2" style="font-size:9px;">Base Points Deducted</td><td style="font-size:9px;">: ${salesReturn.totalBasePoints}</td></tr>` : ""}
              <tr>
                <td colspan="3" style="padding-top:6px; font-size:9px;"><strong>Amount In Words:</strong></td>
              </tr>
              <tr>
                <td colspan="3" class="bold" style="font-size:9px;">${formatAmountInWords(salesReturn.netAmount)}</td>
              </tr>

              <!-- BANK DETAILS -->
              <tr>
                <td colspan="3" style="padding:6px 0 0 0;">
                  <table style="width:100%; border-collapse:collapse; border:1px solid #000;">
                    <tbody>
                      <tr>
                        <td style="padding:4px 6px; vertical-align:top;">
                          <table style="width:100%;">
                            <tbody>
                              <tr><td colspan="2" class="bold" style="font-size:10px;">Bank Details</td></tr>
                              ${bank?.bankName ? `
                              <tr>
                                <td style="width:38%; font-size:9px;">Bank Name</td>
                                <td style="font-size:9px;">: ${escapeHtml(bank.bankName)}</td>
                              </tr>
                              <tr>
                                <td style="font-size:9px;">Branch</td>
                                <td style="font-size:9px;">: ${escapeHtml(bank.branchCode || "")}</td>
                              </tr>
                              <tr>
                                <td style="font-size:9px;">IFSC Code</td>
                                <td style="font-size:9px;">: ${escapeHtml(bank.ifscCode || "")}</td>
                              </tr>
                              <tr>
                                <td style="font-size:9px;">Account Type</td>
                                <td style="font-size:9px;">: ${escapeHtml(bank.accountType || "")}</td>
                              </tr>
                              <tr>
                                <td style="font-size:9px;">Account Number</td>
                                <td style="font-size:9px;">: ${escapeHtml(bank.accountNumber || "")}</td>
                              </tr>` : `
                              <tr><td colspan="2" style="font-size:9px;">Bank details not available.</td></tr>`}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </td>

        <td class="right-section">
          <table>
            <tbody>
              <tr>
                <td style="width:60%; font-size:9px;">Gross Amount</td>
                <td style="width:10%;" class="text-center">:</td>
                <td style="width:30%;" class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.grossAmount)}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Scheme Discount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.schemeDiscount)}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Special Discount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.distributorDiscount)}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">Taxable Amount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.taxableAmount)}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">CGST</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.cgst)}</td>
              </tr>
              <tr>
                <td style="font-size:9px;">SGST</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.sgst)}</td>
              </tr>
              ${Number(salesReturn.igst) > 0 ? `
              <tr>
                <td style="font-size:9px;">IGST</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.igst)}</td>
              </tr>` : ""}
              <tr>
                <td style="font-size:9px;">Invoice Amount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.invoiceAmount)}</td>
              </tr>
              ${salesReturn.roundOffAmount ? `
              <tr>
                <td style="font-size:9px;">Round Off Amount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.roundOffAmount)}</td>
              </tr>` : ""}
              ${Number(salesReturn.cashDiscount) > 0 ? `
              <tr>
                <td style="font-size:9px;">Cash Discount</td>
                <td class="text-center">:</td>
                <td class="text-right" style="font-size:9px;">&#8377;${formatCurrency(salesReturn.cashDiscount)}</td>
              </tr>` : ""}
              <tr class="bold border-top-bold">
                <td style="padding-top:4px; font-size:9px;">Net Amount (Incl. GST)</td>
                <td class="text-center" style="padding-top:4px;">:</td>
                <td class="text-right" style="padding-top:4px; font-size:9px;">&#8377;${formatCurrency(salesReturn.netAmount)}</td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  ${termConditions.length > 0 ? `
  <div class="terms-section">
    <p class="bold" style="font-size:9px; margin:2px 0;">Terms &amp; Conditions:</p>
    <ol style="font-size:9px;">
      ${termConditions.map((term) => `<li>${escapeHtml(term)}</li>`).join("")}
    </ol>
  </div>` : ""}

  <!-- SIGNATURE -->
  <table style="width:100%; font-size:9px; border-bottom:1px solid #000;">
    <tbody>
      <tr>
        <td style="width:50%; vertical-align:bottom; text-align:center; padding:4px 6px;">
          <p class="bold" style="margin:2px 0;">RECEIVED THE RETURNED MATERIAL IN GOOD CONDITION</p>
          <div class="signature-line">
            <p style="margin:2px 0;">RECEIVER'S SIGNATURE AND SEAL</p>
          </div>
        </td>
        <td style="width:50%; vertical-align:bottom; text-align:center; padding:4px 6px;">
          <p class="bold" style="margin:2px 0;">For ${escapeHtml(distributor?.name || "Company Name")}</p>
          <div class="signature-line">
            <p style="margin:2px 0;">Authorised Signatory</p>
          </div>
        </td>
      </tr>
    </tbody>
  </table>

  <div style="padding:3px 8px; text-align:center; font-size:8px; color:#555; border-top:1px solid #000;">
    This is a Computer Generated Sales Return
  </div>

</div>
</body>
</html>`;
};

module.exports = generateSalesReturnHTML;
