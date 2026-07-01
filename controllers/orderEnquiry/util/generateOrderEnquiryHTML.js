const numberToWords = require("../../bill/util/numberToWords");

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const formatDate = (dateString) => {
  if (!dateString) return "";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatCurrency = (amount) => {
  const value = Number(amount);
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
};

const getBoxQty = (product, qtyNumber) => {
  const piecesPerBox = Number(product?.no_of_pieces_in_a_box) || 1;
  const qty = Number(qtyNumber) || 0;
  return (qty / piecesPerBox).toFixed(2);
};

const getTaxAmount = (item) => {
  return (
    (Number(item?.totalCGST) || 0) +
    (Number(item?.totalSGST) || 0) +
    (Number(item?.totalIGST) || 0)
  );
};

const formatAmountInWords = (amount) => {
  const value = Number(amount) || 0;
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  if (!rupees && !paise) {
    return "Zero Rupees Only";
  }

  let text = `${numberToWords(rupees)} Rupees`;

  if (paise > 0) {
    text += ` and ${numberToWords(paise)} Paise`;
  }

  return `${text} Only`;
};

// Channel partner logos stored in Firebase — kept as constants so escapeHtml can be applied at render time
const CHANNEL_PARTNER_LOGOS = [
  {
      url: "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1782883585753.png?alt=media",
    alt: "Ultra Max",
  },
  {
    url: "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1782720406592.png?alt=media",
    alt: "TMT BAR",
  },
  {
    url: "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1782720435420.png?alt=media",
    alt: "SKIPPER PIPES",
  },
  {
    url: "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1782720467231.png?alt=media",
    alt: "DALMIA CEMENT",
  },
];

const generateOrderEnquiryHTML = (orderEnquiry, options = {}) => {
  const distributor = orderEnquiry?.distributorId || {};
  const retailer = orderEnquiry?.retailerId || {};
  const salesman = orderEnquiry?.salesmanName || {};
  const route = orderEnquiry?.routeId || {};
  const bankData = orderEnquiry?.bankData || {};
  const upiData = orderEnquiry?.upiData || {};
  const termConditions = Array.isArray(orderEnquiry?.termConditions)
    ? orderEnquiry.termConditions
    : [];
  const validLineItems = Array.isArray(orderEnquiry?.lineItems)
    ? orderEnquiry.lineItems.filter(
      (item) =>
        item?.product &&
        ((Number(item?.oderQty) || 0) > 0 ||
          (Number(item?.boxOrderQty) || 0) > 0 ||
          (Number(item?.netAmt) || 0) > 0),
    )
    : [];

  const emptyRows = Array.from({
    length: Math.max(0, 20 - validLineItems.length),
  });
  const totalQtyPcs = validLineItems.reduce(
    (sum, item) => sum + (Number(item?.oderQty) || 0),
    0,
  );
  const totalQtyBox = validLineItems.reduce(
    (sum, item) => sum + Number(getBoxQty(item?.product, item?.oderQty)),
    0,
  );
  const convertedOrderNo =
    orderEnquiry?.convertedOrderEntryId?.orderNo ||
    orderEnquiry?.convertedOrderEntryId?.orderId ||
    "";

  const totalDiscountAmount = validLineItems.reduce(
    (sum, item) => sum + (Number(item?.totalDiscountAmount) || 0),
    0,
  );

  // Calculate total pages (20 rows per page)
  const ROWS_PER_PAGE = 20;
  const totalPages = Math.max(
    1,
    Math.ceil(validLineItems.length / ROWS_PER_PAGE),
  );

  // Build channel-partner img tags with escaped URLs
  const channelPartnerImgs = CHANNEL_PARTNER_LOGOS.map(
    ({ url, alt }) =>
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" style="height:82px; width:110px; object-fit:contain; transform:scale(1.08);" onerror="this.style.display='none'">`,
  ).join("\n            ");


  const specialDiscount = validLineItems.reduce((total, item) => {
  const gross = Number(item?.grossAmt) || 0;
  const disc = Number(item?.distributorDisc) || 0;

  let discountAmount = 0;

  if (item?.distributorDiscUnit === "percent") {
    discountAmount = (gross * disc) / 100;
  } else {
    discountAmount = disc;
  }

  return total + discountAmount;
}, 0);
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Enquiry - ${escapeHtml(orderEnquiry?.enquiryNo || "")}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          
          * {
            box-sizing: border-box;
          }
         body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
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
            position: relative;
          }
          .highlight-box {
            background: #fff9e6;
            border-left: 4px solid #ff9800;
            padding: 4px 6px;
            margin: 3px 4px;
            font-size: 7.5px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          .details-table,
          .items-table,
          .summary-table,
          .bank-table,
          .signature-table {
            border-bottom: 1px solid #000;
          }
          .details-table td,
          .summary-table td,
          .bank-table td,
          .signature-table td {
            vertical-align: top;
            padding: 2px 4px;
          }
          .left-section {
            width: 50%;
            border-right: 1px solid #000;
            padding: 4px 6px;
          }
          .right-section {
            width: 50%;
            padding: 4px 6px;
          }
            @page {
  size: A4 portrait;
  margin: 8mm 10mm;

  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 9px;
  }
}
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
            padding: 2px 2px;
            font-size: 8.5px;
          }
          .items-table th:last-child,
          .items-table td:last-child {
            border-right: none;
          }
          .border-top-bold {
            border-top: 2px solid #000;
          }
          .text-left  { text-align: left; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .terms-section {
            padding: 4px 6px;
            border-bottom: 1px solid #000;
          }
          .terms-section ol,
          .terms-section ul {
            margin: 2px 0 0 16px;
            padding: 0;
          }
          .signature-line {
            border-top: 1px solid #000;
            width: 180px;
            margin: 30px auto 0 auto;
            padding-top: 4px;
            text-align: center;
          }

          /* Page number styling - positioned at bottom */
          .page-footer {
            text-align: center;
            font-size: 7px;
            padding: 3px 0;
            border-top: 1px solid #ccc;
            margin-top: 3px;
            color: #555;
            width: 100%;
          }

          /* Prevent awkward page breaks */
          .items-table tbody tr {
            page-break-inside: avoid;
          }
          
          .items-table tbody tr:last-child {
            page-break-after: avoid;
          }

          /* Keep header content together */
          .document-container > div:first-child {
            page-break-after: avoid;
          }
          
          /* Page break after table header */
          .items-table thead {
            page-break-after: avoid;
          }

          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            /* Hide print buttons */
            .print-btn, .close-btn {
              display: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="document-container">

          <!-- HEADER: logo left, company info right (Kedia-style) -->
          <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 12px; border-bottom:1px solid #000;">
           <div style="flex:0 0 105px; height:105px; display:flex; align-items:center; justify-content:center;">
  <img
    src="${escapeHtml(
    options?.logoBase64 ||
    options?.logoUrl ||
    "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1775744543343.png?alt=media",
  )}"
    alt="Company Logo"
    style="width:100%; height:100%; object-fit:contain; display:block;"
    onerror="this.style.display='none'"
  />
</div>
            <div style="flex:1; text-align:right; padding-left:8px;">
  <div style="font-size:20px; font-weight:bold; letter-spacing:0.5px;">
    ${escapeHtml(distributor?.name || "Company Name")}
  </div>
              ${distributor?.address1
      ? `<div style="font-size:9px; margin-top:2px;">${escapeHtml(distributor.address1)}${distributor?.address2 ? `, ${escapeHtml(distributor.address2)}` : ""}</div>`
      : ""
    }
              <div style="font-size:9px; margin-top:1px;">
${distributor?.email ? `Email : ${escapeHtml(distributor.email)}` : ""}${distributor?.email && distributor?.phone ? ", " : ""}${distributor?.phone ? `Phone : ${escapeHtml(distributor.phone)}` : ""}              </div>
              ${distributor?.gst_no || distributor?.stateId?.name
      ? `<div style="font-size:9px; margin-top:1px;">${distributor?.gst_no ? `GSTIN: <strong>${escapeHtml(distributor.gst_no)}</strong>` : ""}${distributor?.gst_no && distributor?.stateId?.name ? " &nbsp;&nbsp; " : ""}${distributor?.stateId?.name ? `State: ${escapeHtml(distributor.stateId.name)}` : ""}</div>`
      : ""
    }
            </div>
          </div>

          <!-- QUOTATION TITLE -->
          <div style="text-align:center; padding:3px 0; border-bottom:1px solid #000; background:#fff;">
            <span style="font-size:10px; font-weight:bold; letter-spacing:2px; text-decoration:underline;">QUOTATION</span>
          </div>

          <!-- CUSTOMER + QUOTATION DETAILS -->
          <table class="details-table">
            <tbody>
              <tr>
                <td class="left-section">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="2" class="bold" style="font-size:9px;">Customer Details</td>
                      </tr>
                      <tr>
                        <td style="width: 30%; font-size:9px;">Name</td>
                        <td style="font-size:9px;">: <strong>${escapeHtml(retailer?.outletName || "")}</strong></td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Customer Code</td>
                        <td style="font-size:9px;">: ${escapeHtml(retailer?.outletCode || "")}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Add/City/Pincode</td>
                        <td style="font-size:9px;">: ${escapeHtml(retailer?.address1 || "")}${retailer?.city ? ` / ${escapeHtml(retailer.city)}` : ""}${retailer?.pin ? ` / ${escapeHtml(retailer.pin)}` : ""}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Ship To Address</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.shipToAddress || "")}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Phone No.</td>
                        <td style="font-size:9px;">: <strong>${escapeHtml(retailer?.mobile1 || "")}</strong></td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Email</td>
                        <td style="font-size:9px;">: ${escapeHtml(retailer?.email || "")}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">GSTIN No.</td>
                        <td style="font-size:9px;">: <strong>${escapeHtml(retailer?.gstin || "")}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </td>

                <td class="right-section">
                  <table>
                    <tbody>
                     
                      <tr>
                        <td style="width: 38%; font-size:9px;">Quotation No.</td>
                        <td style="font-size:9px;">: <strong>${escapeHtml(orderEnquiry?.enquiryNo || "")}</strong></td>
                      </tr>

                      <tr>
                        <td style="font-size:9px;">Quotation Date</td>
                        <td style="font-size:9px;">: ${escapeHtml(formatDate(orderEnquiry?.createdAt))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Validity</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.validity || "")}</td>
                      </tr>
                    
                   
                      <tr>
                        <td style="font-size:9px;">Delivery Schedule</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.deliverySchedule || "")}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Delivery Terms</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.deliveryTerms || "")}</td>
                      </tr>
                     
                      <tr>
                        <td style="font-size:9px;">Payment Terms</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.paymentTerms || "")}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Sales Man</td>
                        <td style="font-size:9px;">: ${escapeHtml(salesman?.name || "")}${salesman?.empId ? ` (${escapeHtml(salesman.empId)})` : ""}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Remarks</td>
                        <td style="font-size:9px;">: ${escapeHtml(orderEnquiry?.remarks || "")}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- INTRODUCTION TEXT -->
          <div style="padding: 4px 8px; font-size: 7.5px; line-height: 1.3; font-weight: bold;margin-bottom:4px;">
            Dear Sirs,<br>
            With reference to your above enquiry we are quoting our lowest rates alongwith estimation as under which we hope will meet your approval and we shall be favoured with valued order.
          </div>

          <!-- LINE ITEMS TABLE -->
          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 3%;">SL</th>
                <th style="width: 24%; text-align:left;">Item Description</th>
                <th style="width: 7%; text-align:right;">HSN</th>
                <th style="width: 5%; text-align:right;">Qty</th>
                <th style="width: 8%; text-align:right;">MRP</th>
                <th style="width: 7%;">Disc%</th>
                <th style="width: 8%; text-align:right;">Basic Price</th>
                <th style="width: 10%; text-align:right;">Basic Amt</th>
              </tr>
            </thead>
            <tbody>
              ${validLineItems
      .map((item, index) => {
        const product = item?.product || {};
        const mrp = Number(
          item?.price?.mrp_price || item?.price?.rlp_price || 0,
        );
        const discPct = Number(item?.totalDiscountPercentage || 0);

        return `
              <tr>
                <td class="text-center" style="font-size:9px;">${index + 1}</td>
                <td class="text-left" style="font-size:9px;">${escapeHtml(product?.name || "")}</td>
                <td class="text-right" style="font-size:9px;">${escapeHtml(product?.product_hsn_code || "")}</td>
                <td class="text-right" style="font-size:9px;">${Number(item?.oderQty) || 0}</td>
                <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(mrp))}</td>
                <td class="text-center" style="font-size:9px;">${discPct > 0 ? discPct.toFixed(2) + "%" : "0.00%"}</td>
                <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(item?.price?.rlp_price || 0))}</td>
                 <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(item?.grossAmt || 0))}</td>
              </tr>`;
      })
      .join("")}
              ${emptyRows
      .map(
        () => `
              <tr>
                <td class="text-center" style="font-size:9px;">-</td>
                <td></td><td></td><td></td><td></td>
                <td></td><td></td><td></td>
              </tr>`,
      )
      .join("")}
            </tbody>
          </table>

          <!-- SUMMARY -->
          <table class="summary-table">
            <tbody>
              <tr>
                <td class="left-section">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="3" class="bold" style="font-size:9px;">E &amp; O.E</td>
                      </tr>

                      ${Number(orderEnquiry?.totalBasePoints) > 0
      ? `<tr>
                        <td colspan="2" style="font-size:9px;">Base Points</td>
                        <td style="font-size:9px;">: ${Number(orderEnquiry.totalBasePoints) || 0}</td>
                      </tr>`
      : ""
    }
                      <tr>
                        <td colspan="3" style="padding-top:6px; font-size:9px;">
                          <strong>Amount In Words:</strong>
                        </td>
                      </tr>
                     <tr>
  <td colspan="3" class="bold" style="font-size:9px;">
    ${escapeHtml(formatAmountInWords(orderEnquiry?.netAmount))}
  </td>
</tr>

<tr>
  <td colspan="3" style="padding:6px 0 0 0;">
    ${bankData?.bankName || upiData?.upiId
      ? `
        <table style="width:100%; border-collapse:collapse; border:1px solid #000;">
          <tbody>
            <tr>
              <td style="width:70%; padding:4px 6px; vertical-align:top; border-right:1px solid #000;">
                <table style="width:100%;">
                  <tbody>
                    <tr>
                      <td colspan="2" class="bold" style="font-size:11px;">Bank Details</td>
                    </tr>

                    ${bankData?.bankName
        ? `
                    <tr>
                      <td style="width:35%; font-size:9px;">Bank Name</td>
                      <td style="font-size:9px;">: ${escapeHtml(bankData.bankName)}</td>
                    </tr>
                    <tr>
                      <td style="font-size:9px;">Branch</td>
                      <td style="font-size:9px;">: ${escapeHtml(bankData.branchCode || "")}</td>
                    </tr>
                    <tr>
                      <td style="font-size:9px;">IFSC Code</td>
                      <td style="font-size:9px;">: ${escapeHtml(bankData.ifscCode || "")}</td>
                    </tr>
                    <tr>
                      <td style="font-size:9px;">Account Type</td>
                      <td style="font-size:9px;">: ${escapeHtml(bankData.accountType || "")}</td>
                    </tr>
                    <tr>
                      <td style="font-size:9px;">Account Number</td>
                      <td style="font-size:9px;">: ${escapeHtml(bankData.accountNumber || "")}</td>
                    </tr>
                    `
        : `
                    <tr>
                      <td colspan="2" style="font-size:9px;">
                        Bank details are not available.
                      </td>
                    </tr>`
      }

                  </tbody>
                </table>
              </td>

              <td style="width:30%; padding:4px 6px; vertical-align:top;">
                <table style="width:100%;">
                  <tbody>
                    <tr>
                      <td class="bold" style="font-size:9px;">UPI Details</td>
                    </tr>
                    <tr>
                      <td style="font-size:9px;">
                        ${upiData?.upiId
        ? escapeHtml(`UPI ID: ${upiData.upiId}`)
        : "UPI details are not available."
      }
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>

            </tr>
          </tbody>
        </table>
        `
      : `
        <table style="width:100%; border-collapse:collapse; border:1px solid #000;">
          <tbody>
            <tr>
              <td style="padding:6px; font-size:9px;">
                <strong>Bank Details</strong><br><br>
                <strong>Beneficiary :</strong> Infrawal Projects Private Limited<br>
                <strong>Bank :</strong> ICICI Bank<br>
                <strong>Branch :</strong> Liluah Branch<br>
                <strong>IFSC Code :</strong> ICIC0006948<br>
                <strong>A/C No :</strong> 694805501076<br>
                <strong>UPI ID :</strong> infra96577.ibz@icici
              </td>
            </tr>
          </tbody>
        </table>
        `
    }
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
                        <td style="width:10%;" class="text-center" style="font-size:9px;">:</td>
                        <td style="width:30%;" class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.grossAmount))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Special Discount</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(specialDiscount))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Freight &amp; Handling Fee</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency((orderEnquiry?.freightCharges || 0) + (orderEnquiry?.handlingCharges || 0)))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Taxable Amount</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.taxableAmount))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">CGST</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.cgst))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">SGST</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.sgst))}</td>
                      </tr>
                      ${Number(orderEnquiry?.igst) > 0
      ? `<tr>
                        <td style="font-size:9px;">IGST</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.igst))}</td>
                      </tr>`
      : ""
    }
                      <tr>
                        <td style="font-size:9px;">Invoice Amount</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.invoiceAmount))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:9px;">Round Off Amount</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.roundOffAmount))}</td>
                      </tr>
                      ${Number(orderEnquiry?.cashDiscount) > 0 ||
      orderEnquiry?.cashDiscountApplied
      ? `<tr>
                        <td style="font-size:9px;">Cash Discount</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.cashDiscount))}</td>
                      </tr>`
      : ""
    }
                      ${Number(orderEnquiry?.creditAmount) > 0
      ? `<tr>
                        <td style="font-size:9px;">Credit Note Adjustment</td>
                        <td class="text-center" style="font-size:9px;">:</td>
                        <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.creditAmount))}</td>
                      </tr>`
      : ""
    }
                      <tr class="bold border-top-bold" style="font-weight:bold;">
                        <td style="padding-top:4px; font-size:9px;">Net Amount</td>
                        <td class="text-center" style="padding-top:4px; font-size:9px;">:</td>
                        <td class="text-right" style="padding-top:4px; font-size:9px;">&#8377;${escapeHtml(formatCurrency(orderEnquiry?.netAmount))}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

        

          <!-- TERMS & CONDITIONS -->
          ${termConditions.length > 0
      ? `
          <div class="terms-section">
            <p class="bold" style="font-size:9px; margin:2px 0;">Terms &amp; Conditions:</p>
            <ol style="font-size:9px;">
              ${termConditions.map((term) => `<li>${escapeHtml(term)}</li>`).join("")}
            </ol>
          </div>`
      : ""
    }

          <!-- NOTE & SIGNATURE -->
          <table style="width:100%; font-size:9px; border-bottom:1px solid #000;">
            <tbody>
              <tr>
                <td style="width:60%; vertical-align:top; padding:4px 6px;">
                  <strong>Note:</strong>
                  <ul style="margin:2px 0; padding-left:14px; font-size:9px;">
                    <li>Kindly incorporate plus/minus 5% variation in quantity at the time of placing the order with us.</li>
                    <li>Test Certificate may be provided if required.</li>
                    <li>Inspection of materials if required may be done at our godown with prior information.</li>
                    <li>Unloading arrangement to be done by buyer.</li>
                  </ul>
                </td>
                <td style="width:40%; vertical-align:bottom; text-align:center; padding:4px 6px;">
                  <p class="bold" style="margin:2px 0; font-size:9px;">For ${escapeHtml(distributor?.name || "Company Name")}</p>
                  <div class="signature-line">
                    <p style="margin:2px 0; font-size:9px;">Authorised Signatory</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- CHANNEL PARTNERS FOOTER -->
          <div style="padding:4px 8px; border-top:1px solid #000;">
            <span style="font-size:9px; font-weight:bold; color:#555;">Channel Partners for:</span><br/>
            <div style="display:flex; align-items:center; justify-content:space-evenly; margin-top:3px; flex-wrap:wrap; gap:5px;">
              ${channelPartnerImgs}
            </div>
          </div>

          <!-- PAGE NUMBER AT BOTTOM -->
          <div style="padding:3px 8px; text-align:center; font-size:9px; color:#555; border-top:1px solid #000;">
            Page 1 of ${totalPages}
          </div>
          </div>

        </div>
      </body>
    </html>
  `;
};

module.exports = generateOrderEnquiryHTML;