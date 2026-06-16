const numberToWords = require("./numberToWords");
const QRCode = require("qrcode");

async function generateBillHTML(bill, options = {}) {
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return "0.00";
    return parseFloat(amount).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const distributor = bill.distributorId || {};
  const bankData = bill.bankData || {};
  const upiData = bill.upiData || null;
  const retailer = bill.retailerId || {};
  const order = bill.orderId || {};
  const salesman = bill.salesmanName || {};
  const route = bill.routeId || {};

  const eInvoice = bill.eInvoice || {};
  const irn = eInvoice.irn || bill.irn || "";
  const ackNo = eInvoice.ackNo || bill.ackNo || "";
  const ackDate = eInvoice.ackDate ? formatDate(eInvoice.ackDate) : (bill.ackDate ? formatDate(bill.ackDate) : "");
  const eWayBillNo = eInvoice.eWayBillNo || bill.eWayBillNo || "";

  const validLineItems = (bill.lineItems || []).filter(
    (item) => item?.billQty > 0
  );

  const generateUpiQR = async (upiId) => {
    if (!upiId) return "";
    try {
      return await QRCode.toDataURL(`upi://pay?pa=${upiId}&pn=Payment`);
    } catch (error) {
      console.error("QR Code generation error:", error);
      return "";
    }
  };

  let upiQRCode = "";
  if (upiData?.upiId) {
    upiQRCode = await generateUpiQR(upiData.upiId);
  }

  let lineItemsHTML = "";
  validLineItems.forEach((item, index) => {
    const product = item.product || {};
    const discPct = formatCurrency(item.totalDiscountPercentage || 0);
    const amount = formatCurrency(item.netAmt);

    lineItemsHTML += `
      <tr>
        <td class="cell center">${index + 1}</td>
        <td class="cell left">
          <strong>${(product.name || "").replace(/\b\d{3}\b/g, "<b>$&</b>")} ${product.product_code || ""}</strong>
        </td>
        <td class="cell center">${product.product_hsn_code || ""}</td>
        <td class="cell center"><strong>${item.billQty || 0} Pcs</strong></td>
        <td class="cell right">${formatCurrency(item.price?.rlp_price || 0)}</td>
        <td class="cell center">Pcs</td>
        <td class="cell center">${discPct}%</td>
        <td class="cell right"><strong>${amount}</strong></td>
      </tr>
    `;
  });

  const amountInWords = () => {
    const amount = bill.netAmount || 0;
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let result = numberToWords(rupees) + " Rupees";
    if (paise > 0) result += " and " + numberToWords(paise) + " Paise";
    return result + " Only";
  };

  const totalQty = validLineItems.reduce((s, i) => s + (i.billQty || 0), 0);
  const igstVisible = bill?.igst && parseFloat(bill.igst) > 0;

  // Build HSN/SAC tax breakup rows
  const cgstRate = bill?.cgstRate || 9;
  const sgstRate = bill?.sgstRate || 9;
  const hsnMap = {};
  validLineItems.forEach(item => {
    const hsn = item.product?.product_hsn_code || "";
    const taxableAmt = item.netAmt || 0;
    if (!hsnMap[hsn]) hsnMap[hsn] = { taxable: 0 };
    hsnMap[hsn].taxable += taxableAmt;
  });

  let hsnRowsHTML = "";
  let grandTaxable = 0, grandCgst = 0, grandSgst = 0;
  Object.entries(hsnMap).forEach(([hsn, data]) => {
    const taxable = bill?.netAmount || 0;
    const cgstAmt = taxable * cgstRate / 100;
    const sgstAmt = taxable * sgstRate / 100;
    grandTaxable += taxable;
    grandCgst += cgstAmt;
    grandSgst += sgstAmt;
    hsnRowsHTML += `<tr>
      <td class="hcell">${hsn}</td>
      <td class="hcell right">${formatCurrency(bill?.netAmount)}</td>
      <td class="hcell center">${cgstRate}%</td>
      <td class="hcell right">${formatCurrency(cgstAmt)}</td>
      <td class="hcell center">${sgstRate}%</td>
      <td class="hcell right">${formatCurrency(sgstAmt)}</td>
      <td class="hcell right">${formatCurrency(cgstAmt + sgstAmt)}</td>
    </tr>`;
  });
  hsnRowsHTML += `<tr class="hsn-total-row">
    <td class="hcell right"><strong>Total</strong></td>
    <td class="hcell right"><strong>${formatCurrency(bill?.netAmount)}</strong></td>
    <td class="hcell"></td>
    <td class="hcell right"><strong>${formatCurrency(grandCgst)}</strong></td>
    <td class="hcell"></td>
    <td class="hcell right"><strong>${formatCurrency(grandSgst)}</strong></td>
    <td class="hcell right"><strong>${formatCurrency(grandCgst + grandSgst)}</strong></td>
  </tr>`;



  const totalTaxAmount = grandCgst + grandSgst + (bill.igst || 0);

  const taxAmountInWords = () => {
    const rupees = Math.floor(totalTaxAmount);
    const paise = Math.round((totalTaxAmount - rupees) * 100);

    let result = numberToWords(rupees) + " Rupees";

    if (paise > 0) {
      result += " and " + numberToWords(paise) + " Paise";
    }

    return result + " Only";
  };


  let emptyRowsHTML = "";

  const emptyRowCount = Math.max(0, 18 - validLineItems.length);

  for (let i = 0; i < emptyRowCount; i++) {
    emptyRowsHTML += `
    <tr class="empty-row">
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
      <td class="empty-cell"></td>
    </tr>
  `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${bill.new_billno || bill.billNo ? "Invoice_" + (bill.new_billno || bill.billNo) : "Invoice"}</title>
  <style>
    @page { size: A4; margin: 6mm 6mm 6mm 6mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; min-height: 100%; }
    body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: #000;
      background: #e0e0e0;
      padding: 20px 0;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      border: 1px solid #000;
      background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
      display: flex;
      flex-direction: column;
    }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .page {
        width: 100% !important;
        min-height: calc(297mm - 12mm) !important;
        box-shadow: none !important;
        margin: 0 !important;
      }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }

    /* TOP HEADER */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 6px 10px 5px;
      border-bottom: 1px solid #000;
    }
    .top-header-center { text-align: center; flex: 1; }
    .top-header-center .title-row {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 30px;
    }
    .tax-invoice-title { font-size: 17px; font-weight: bold; }
    .original-label { font-style: italic; font-size: 11px; }
    .e-invoice-label { font-size: 12px; font-weight: bold; }
    .irn-block { margin-top: 4px; font-size: 10px; }
    .irn-block p { margin: 2px 0; }
    .qr-block { text-align: right; }
    .qr-block img { width: 90px; height: 90px; border: 1px solid #ccc; }
    .qr-placeholder {
      width: 90px; height: 90px; border: 1px solid #ccc;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; color: #aaa;
    }

    /* SELLER META */
    .seller-meta { display: flex; border-bottom: 1px solid #000; }
    .seller-box { width: 45%; border-right: 1px solid #000; padding: 6px 8px; }
    .seller-box .company-name { font-size: 13px; font-weight: bold; margin-bottom: 3px; }
    .seller-box p { margin: 2px 0; font-size: 10px; }
    .meta-box { width: 55%; padding: 0; }
    .meta-grid { width: 100%; border-collapse: collapse; font-size: 10px; }
    .meta-grid td {
      border-bottom: 1px solid #000;
      border-right: 1px solid #000;
      padding: 4px 6px;
      vertical-align: top;
    }
    .meta-grid td:last-child { border-right: none; }
    .meta-grid tr:last-child td { border-bottom: none; }
    .meta-label { font-size: 9px; color: #444; }
    .meta-value { font-weight: bold; font-size: 10px; }

    /* PARTIES */
    .parties-meta-row { display: flex; border-bottom: 1px solid #000; }
    .parties-stack { width: 45%; border-right: 1px solid #000; display: flex; flex-direction: column; }
    .party-box { padding: 5px 8px; }
    .party-box + .party-box { border-top: 1px solid #000; }
    .party-box .party-title { font-size: 10px; font-weight: bold; text-decoration: underline; margin-bottom: 3px; }
    .party-box .party-name { font-weight: bold; font-size: 11px; }
    .party-box p { margin: 2px 0; font-size: 10px; }
    .meta-box-right { width: 55%; padding: 0; }
    .meta-grid-right { width: 100%; border-collapse: collapse; font-size: 10px; height: 100%; }
    .meta-grid-right td {
      border-bottom: 1px solid #000;
      border-right: 1px solid #000;
      padding: 4px 6px;
      vertical-align: top;
    }
    .meta-grid-right td:last-child { border-right: none; }
    .meta-grid-right tr:last-child td { border-bottom: none; }

    /* ITEMS SECTION */
    .items-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid #000;
      overflow: hidden;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      table-layout: fixed;
    }
    .items-table th {
      background: #f0f0f0;
      border: 1px solid #000;
      padding: 4px 5px;
      text-align: center;
      font-size: 10px;
    }
    .items-table th.left { text-align: left; }
 .items-table td.cell {
  border-left: 1px solid #000;
  border-right: 1px solid #000;
  border-top: none;
  border-bottom: none;
  padding: 4px 5px;
  vertical-align: top;
}
  .empty-cell {
  height: 22px;

  /* only vertical lines */
  border-left: 1px solid #000;
  border-right: 1px solid #000;

  /* no horizontal lines */
  border-top: none;
  border-bottom: none;

  padding: 0;
}
  .empty-row td {
  height: 22px;
}
    .items-table tbody tr td.cell:first-child { border-left: 1px solid #000; }
    .items-table tbody tr td.cell:last-child  { border-right: 1px solid #000; }
    .items-table td.center { text-align: center; }
    .items-table td.right  { text-align: right; }
    .items-table td.left   { text-align: left; }
    .items-table-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .items-table-wrap .items-table { height: 100%; }
  
    .subtotal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      table-layout: fixed;
      flex-shrink: 0;
      border-top: 2px solid #000;
    }
    .subtotal-table td { padding: 3px 5px; border: none; }
    .subtotal-table .amount-col {
      text-align: right;
      font-weight: bold;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
      border-bottom: 1px solid #ccc;
    }
    .subtotal-table .label-col {
      font-style: italic;
      font-weight: bold;
      text-align: right;
    }

    /* ── AMOUNT IN WORDS ROW ── */
    .aow-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-top: 2px solid #000;
      border-bottom: 1px solid #000;
      padding: 4px 8px;
      font-size: 10px;
    }
    .aow-left { flex: 1; }
    .aow-words { font-weight: bold; font-size: 11px; margin-top: 2px; }
    .aow-right { font-style: italic; font-size: 10px; white-space: nowrap; margin-left: 10px; }

    /* ── HSN/SAC TAX TABLE ── */
    .hsn-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      border-bottom: 1px solid #000;
    }
    .hsn-table th {
      border: 1px solid #000;
      padding: 3px 5px;
      text-align: center;
      background: #f0f0f0;
      font-size: 10px;
    }
    .hsn-table td.hcell {
      border: 1px solid #000;
      padding: 3px 6px;
      font-size: 10px;
    }
    .hsn-table td.right { text-align: right; }
    .hsn-table td.center { text-align: center; }
    .hsn-total-row td { border-top: 2px solid #000 !important; }

    /* ── TAX AMOUNT IN WORDS ── */
    .tax-words-section {
      border-bottom: 1px solid #000;
      padding: 4px 8px;
      font-size: 10px;
    }

    /* ── BOTTOM: DECLARATION + BANK ── */
    .bottom-section {
      display: flex;
      font-size: 10px;
      border-bottom: 1px solid #000;
      min-height: 90px;
    }
    .bottom-left {
      width: 45%;
      border-right: 1px solid #000;
      padding: 6px 8px;
    }
    .declaration-title {
      font-weight: bold;
      text-decoration: underline;
      margin-bottom: 4px;
      font-size: 10px;
    }
    .bottom-right {
      width: 55%;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
    }
    .bank-title {
      font-weight: bold;
      text-decoration: underline;
      margin-bottom: 4px;
      font-size: 10px;
    }
    .bank-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    .bank-table td { padding: 2px 4px; vertical-align: top; }
    .bank-table td:first-child { width: 42%; white-space: nowrap; }
.bottom-right {
  width: 55%;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
}

.company-sign {
  margin-top: auto;
  padding-bottom: 30px;   /* pushes block upward */
  font-weight: bold;
  font-size: 10px;
  text-align: right;
}

.authorised-sign {
  font-size: 10px;
  text-align: right;
}  /* ── FOOTER ── */
    .page-footer {
      border-top: 1px solid #000;
      text-align: center;
      font-size: 10px;
      padding: 4px;
      color: #444;
    }
  </style>
</head>
<body>
<div class="page">

  <!-- TOP HEADER -->
  <div class="top-header">
    <div class="irn-block">
      <div style="margin-top:36px;">
        <p><strong>IRN</strong> : ${irn || ""}</p>
        <p><strong>Ack No.</strong> : ${ackNo || ""}</p>
        <p><strong>Ack Date</strong> : ${ackDate || ""}</p>
      </div>
    </div>
    <div class="top-header-center">
      <div class="title-row">
        <span class="tax-invoice-title">Tax Invoice</span>
        <span class="original-label">(ORIGINAL FOR RECIPIENT)</span>
        <span class="e-invoice-label">e-Invoice</span>
      </div>
    </div>
    <div class="qr-block">
      ${upiQRCode
      ? `<img src="${upiQRCode}" alt="QR Code" />`
      : `<div class="qr-placeholder">QR</div>`}
    </div>
  </div>

  <!-- SELLER + META -->
  <div class="seller-meta">
    <div class="seller-box">
      <div class="company-name">${distributor.name || "Company Name"}</div>
      <p>${distributor.address1 || ""}, ${distributor.address2 || ""}</p>
      <p>GSTIN/UIN: ${distributor.gst_no || ""}</p>
      <p>State Name: ${distributor?.stateId?.name || ""}${distributor?.stateId?.slug ? ", Code: " + (distributor?.stateId?.code || "") : ""}</p>
      <p>E-Mail: ${distributor.email || ""}</p>
      <p>Phone: ${distributor.phone || ""}</p>
    </div>
    <div class="meta-box">
      <table class="meta-grid">
        <tr>
          <td style="width:50%">
            <div class="meta-label">Invoice No.</div>
            <div class="meta-value">${bill.new_billno || bill.billNo || ""}</div>
          </td>
          <td>
            <div class="meta-label">e-Way Bill No.</div>
            <div class="meta-value">${eWayBillNo || "-"}</div>
          </td>
          <td>
            <div class="meta-label">Dated</div>
            <div class="meta-value">${formatDate(bill?.createdAt)}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Order No.</div>
            <div class="meta-value">${order?.orderNo || "-"}</div>
          </td>
          <td colspan="2">
            <div class="meta-label">Mode/Terms of Payment</div>
            <div class="meta-value">${bill.paymentMode || "NEFT/RTGS"}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Sales Man</div>
            <div class="meta-value">${salesman.name || ""} (${salesman?.empId || ""})</div>
          </td>
          <td colspan="2">
            <div class="meta-label">Beat / Route</div>
            <div class="meta-value">${route.name || ""} (${route?.code || ""})</div>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <!-- CONSIGNEE + BUYER -->
  <div class="parties-meta-row">
    <div class="parties-stack">
      <div class="party-box">
        <div class="party-title">Consignee (Ship to)</div>
        <div class="party-name">${retailer?.outletName || ""} (${retailer?.outletUID || ""})</div>
        <p>${retailer.address1 || ""}, ${retailer.city || ""}</p>
        <p>Pin Code: ${retailer.pin || ""}</p>
        <p>GSTIN/UIN : ${retailer.gstin || ""}</p>
        <p>State Name : ${retailer?.stateId?.name || retailer.state || ""}</p>
      </div>
      <div class="party-box">
        <div class="party-title">Buyer (Bill to)</div>
        <div class="party-name">${retailer?.outletName || ""} (${retailer?.outletUID || ""})</div>
        <p>${retailer.address1 || ""}, ${retailer.city || ""}</p>
        <p>Pin Code: ${retailer.pin || ""}</p>
        <p>GSTIN/UIN : ${retailer.gstin || ""}</p>
        <p>Phone: ${retailer.mobile1 || ""}</p>
      </div>
    </div>
    <div class="meta-box-right">
      <table class="meta-grid-right">
        <tr>
          <td style="width:50%">
            <div class="meta-label">Delivery Note</div>
            <div class="meta-value">${bill.deliveryNote || ""}</div>
          </td>
          <td>
            <div class="meta-label">Mode/Terms of Payment</div>
            <div class="meta-value">${bill.paymentMode || "NEFT/RTGS"}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Reference No. &amp; Date.</div>
            <div class="meta-value">${bill.referenceNo || ""}</div>
          </td>
          <td>
            <div class="meta-label">Other References</div>
            <div class="meta-value">${bill.otherReferences || ""}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Buyer's Order No.</div>
            <div class="meta-value">${order?.buyerOrderNo || ""}</div>
          </td>
          <td>
            <div class="meta-label">Dated</div>
            <div class="meta-value">${order?.buyerOrderDate ? formatDate(order.buyerOrderDate) : ""}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Dispatch Doc No.</div>
            <div class="meta-value">${bill.dispatchDocNo || bill.new_billno || bill.billNo || ""}</div>
          </td>
          <td>
            <div class="meta-label">Delivery Note Date</div>
            <div class="meta-value">${bill.deliveryNoteDate ? formatDate(bill.deliveryNoteDate) : ""}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Dispatched through</div>
            <div class="meta-value">${bill.dispatchedThrough || ""}</div>
          </td>
          <td>
            <div class="meta-label">Destination</div>
            <div class="meta-value">${bill.destination || ""}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div class="meta-label">Bill of Lading/LR-RR No.</div>
            <div class="meta-value">${bill.lrNo || ""}</div>
          </td>
          <td>
            <div class="meta-label">Motor Vehicle No.</div>
            <div class="meta-value">${bill.motorVehicleNo || ""}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div class="meta-label">Terms of Delivery</div>
            <div class="meta-value">${bill.termsOfDelivery || ""}</div>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <!-- ITEMS SECTION -->
  <div class="items-section">
    <table class="items-table" style="flex-shrink:0;">
      <colgroup>
        <col style="width:3%"><col style="width:35%"><col style="width:8%">
        <col style="width:10%"><col style="width:9%"><col style="width:5%">
        <col style="width:8%"><col style="width:12%">
      </colgroup>
      <thead>
        <tr>
          <th>Sl<br>No.</th>
          <th class="left">Description of<br>Goods and Services</th>
          <th>HSN/SAC</th>
          <th>Quantity</th>
          <th>Rate</th>
          <th>Per</th>
          <th>Disc. %</th>
          <th>Amount</th>
        </tr>
      </thead>
    </table>

    <div class="items-table-wrap">
      <table class="items-table" style="height:100%;">
        <colgroup>
          <col style="width:3%"><col style="width:35%"><col style="width:8%">
          <col style="width:10%"><col style="width:9%"><col style="width:5%">
          <col style="width:8%"><col style="width:12%">
        </colgroup>
        <tbody>
        ${lineItemsHTML}
        ${emptyRowsHTML}

        </tbody>
      </table>
    </div>

    <table class="subtotal-table">
      <colgroup>
        <col style="width:3%"><col style="width:35%"><col style="width:8%">
        <col style="width:10%"><col style="width:9%"><col style="width:5%">
        <col style="width:8%"><col style="width:12%">
      </colgroup>
      <tbody>
        <tr>
          <td colspan="3"></td>
          <td class="amount-col" style="text-align:center; font-weight:bold;">${totalQty} Pcs</td>
          <td colspan="3"></td>
          <td class="amount-col">${formatCurrency(bill?.grossAmount)}</td>
        </tr>
        <tr>
          <td colspan="6" class="label-col">CGST @ ${cgstRate}%</td>
          <td></td>
          <td class="amount-col">${formatCurrency(bill?.cgst)}</td>
        </tr>
        <tr>
          <td colspan="6" class="label-col">SGST @ ${sgstRate}%</td>
          <td></td>
          <td class="amount-col">${formatCurrency(bill?.sgst)}</td>
        </tr>
        ${igstVisible ? `
        <tr>
          <td colspan="6" class="label-col">IGST @ ${bill?.igstRate || "18"}%</td>
          <td></td>
          <td class="amount-col">${formatCurrency(bill?.igst)}</td>
        </tr>` : ""}
        
      </tbody>
    </table>
  </div>

  <!-- AMOUNT CHARGEABLE IN WORDS + AMOUNT + E.&O.E -->
  <div class="aow-row">
    <div class="aow-left">
      <p style="font-size:9px; margin-bottom:2px;">Amount Chargeable (in words)</p>
      <p class="aow-words">INR ${amountInWords()}</p>
    </div>
    <div class="aow-right">
      <div style="text-align:right; font-size:9px; margin-bottom:2px;">E. &amp; O.E</div>
      <div style="text-align:right; font-weight:bold; font-size:12px;">&#8377; ${formatCurrency(bill?.netAmount)}</div>
    </div>
  </div>

  <!-- HSN/SAC TAX BREAKUP TABLE -->
  <table class="hsn-table">
    <thead>
      <tr>
        <th rowspan="2" style="width:28%; text-align:center;">HSN/SAC</th>
        <th rowspan="2" style="width:14%;">Taxable<br>Value</th>
        <th colspan="2" style="border-bottom:1px solid #000;">CGST</th>
        <th colspan="2" style="border-bottom:1px solid #000;">SGST/UTGST</th>
        <th rowspan="2" style="width:13%;">Total<br>Tax Amount</th>
      </tr>
      <tr>
        <th style="width:7%">Rate</th>
        <th style="width:10%">Amount</th>
        <th style="width:7%">Rate</th>
        <th style="width:10%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${hsnRowsHTML}
    </tbody>
  </table>

  <!-- TAX AMOUNT IN WORDS -->
  <div class="tax-words-section">
  <strong>Tax Amount (in words) :</strong>
  <strong>&nbsp;INR ${taxAmountInWords()}</strong>
</div>

  <!-- BOTTOM: DECLARATION (left) | BANK DETAILS + SIGN (right) -->
  <div class="bottom-section">
    <div class="bottom-left">
      <div class="declaration-title">Declaration</div>
      <p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p>
    </div>
    <div class="bottom-right">
      <div class="bank-title">Company's Bank Details</div>
      <table class="bank-table">
        <tr><td>A/c Holder's Name</td><td>: <strong>${distributor.name || ""}</strong></td></tr>
        <tr><td>Bank Name</td><td>: <strong>${bankData?.bankName || ""}</strong></td></tr>
        <tr><td>A/c No.</td><td>: <strong>${bankData?.accountNumber || ""}</strong></td></tr>
        <tr><td>Branch &amp; IFS Code</td><td>: <strong>${bankData?.branchCode || ""}${bankData?.ifscCode ? " & " + bankData.ifscCode : ""}</strong></td></tr>
      </table>
      <div class="company-sign">for ${distributor.name || ""}</div>
      <div class="authorised-sign">Authorised Signatory</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="page-footer">
    SUBJECT TO ${distributor?.stateId?.name?.toUpperCase() || "KOLKATA"} JURISDICTION ONLY &nbsp;|&nbsp; This is a Computer Generated Invoice
  </div>

</div>
</body>
</html>`;
}

module.exports = generateBillHTML;