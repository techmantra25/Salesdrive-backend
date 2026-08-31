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

// ---------------------------------------------------------------------------
// PAGINATION CAPACITY
// ---------------------------------------------------------------------------
// The old code used one fixed ROWS_PER_PAGE (20) for every page, and then
// force-padded every page's table with blank "-" rows up to that count.
// That caused two separate sources of wasted space:
//   1. Pages 1..N-1 (no summary/terms/signature/footer block) actually have
//      room for far more than 20 rows before the table hits the bottom of
//      the printable area, so a lot of the page below row 20 sat empty.
//   2. The last page carries a lot of extra fixed-height content (E&O.E /
//      amount-in-words / bank+UPI box, terms & conditions, note &
//      signature, channel-partner logos, page footer) — so it can fit far
//      fewer item rows — yet it was still padded out to the full 20 with
//      blank rows, adding a wall of empty "-" rows for no reason.
//
// Fix: use two capacities instead of one, and don't force-pad rows at all.
//   - REGULAR_PAGE_ROWS: max item rows on a page that does NOT carry the
//     summary/terms/signature/footer block (i.e. any page except the last).
//   - LAST_PAGE_ROWS: max item rows on the page that DOES carry that block.
// Both numbers are estimates based on ~9px row height inside an A4 page
// with 8mm/10mm margins. If real printed output still overflows a page or
// leaves a visible gap, nudge these two constants — nothing else needs to
// change.
const REGULAR_PAGE_ROWS = 40;
const LAST_PAGE_ROWS_BASE = 20;
const LAST_PAGE_ROWS_MIN = 20;
// Terms & conditions add variable-height content to the last page too, so
// shave a couple of rows off its budget for every few terms listed — but
// never let it drop below LAST_PAGE_ROWS_MIN. So the row budget for any
// page is: minimum 20 rows, maximum however many fit on that page
// (REGULAR_PAGE_ROWS for non-last pages, shrinking only for the last page
// if terms & conditions eat into the space, and never below 20).
const getLastPageRowBudget = (termConditionsCount) =>
  Math.max(
    LAST_PAGE_ROWS_MIN,
    LAST_PAGE_ROWS_BASE - Math.ceil(termConditionsCount / 2),
  );

// Every page now repeats the full summary/bank/terms/signature/footer
// block, so every page — not just the last — needs room for that block.
// Capacity is therefore the same on every page: whatever fits alongside
// the full footer content (adjusted for how many terms & conditions
// there are, same as before).
const paginateLineItems = (items, termConditionsCount) => {
  const rowsPerPage = getLastPageRowBudget(termConditionsCount);

  if (items.length === 0) {
    return [[]];
  }

  const pages = [];
  let remaining = items.slice();

  while (remaining.length > 0) {
    pages.push(remaining.slice(0, rowsPerPage));
    remaining = remaining.slice(rowsPerPage);
  }

  return pages;
};
// ---------------------------------------------------------------------------
// Small render helpers — each one returns a chunk of markup. Splitting things
// up like this is what lets us repeat the exact same header/table-head/etc.
// on every printed page instead of only once at the very top of the document.
// ---------------------------------------------------------------------------

const renderChannelPartnerImgs = () =>
  CHANNEL_PARTNER_LOGOS.map(
    ({ url, alt }) =>
      `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" style="height:82px; width:110px; object-fit:contain; transform:scale(1.08);" onerror="this.style.display='none'">`,
  ).join("\n            ");

const renderCompanyHeader = (distributor, options) => `
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
          </div>`;

const renderCustomerAndQuotationDetails = (distributor, retailer, orderEnquiry) => `
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
          </div>`;

// Minimum number of rows the items table should always show on any page,
// regardless of how many real line items landed on that page. If a page
// has fewer real items than this, the shortfall is padded out with blank
// "-" rows so the table never looks sparse/collapsed to just a couple rows.
const MIN_TABLE_ROWS = 20;

const renderBlankItemsRow = () => `
              <tr>
                <td class="text-center" style="font-size:9px;">-</td>
                <td class="text-left" style="font-size:9px;">-</td>
                <td class="text-right" style="font-size:9px;">-</td>
                <td class="text-right" style="font-size:9px;">-</td>
                <td class="text-right" style="font-size:9px;">-</td>
                <td class="text-center" style="font-size:9px;">-</td>
                <td class="text-right" style="font-size:9px;">-</td>
                <td class="text-right" style="font-size:9px;">-</td>
              </tr>`;

const renderItemsTable = (itemsForPage, startIndex, minRows = MIN_TABLE_ROWS) => {
  const blankRowsNeeded = Math.max(0, minRows - itemsForPage.length);

  return `
          <!-- LINE ITEMS TABLE -->
          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 3%;">SL</th>
                <th style="width: 24%; text-align:center;">Item Description</th>
                <th style="width: 7%; text-align:center;">HSN</th>
                <th style="width: 5%; text-align:center;">Qty</th>
                <th style="width: 8%; text-align:center;">MRP</th>
                <th style="width: 7%;">Disc%</th>
                <th style="width: 8%; text-align:center;">Basic Price</th>
                <th style="width: 10%; text-align:center;">Basic Amt</th>
              </tr>
            </thead>
            <tbody>
              ${itemsForPage
      .map((item, index) => {
        const product = item?.product || {};

        const discPct = Number(item?.totalDiscountPercentage || 0);
        const qty = Number(item?.oderQty || 0);

        const mrp = Number(
          item?.price?.mrp_price || item?.price?.rlp_price || 0
        );

        const discountPercent = Number(item?.totalDiscountPercentage || 0);

        const effectiveAmount = Number(item?.taxableAmt || 0);

        const effectivePrice =
          qty > 0 ? effectiveAmount / qty : 0;

        return `
              <tr>
                <td class="text-center" style="font-size:9px;">${startIndex + index + 1}</td>
                <td class="text-left" style="font-size:9px;">${escapeHtml(product?.name || "")}</td>
                <td class="text-right" style="font-size:9px;">${escapeHtml(product?.product_hsn_code || "")}</td>
                <td class="text-right" style="font-size:9px;">${Number(item?.oderQty) || 0}</td>
                <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(mrp))}</td>
                <td class="text-center" style="font-size:9px;">${discPct > 0 ? discPct.toFixed(2) + "%" : "0.00%"}</td>
                <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(effectivePrice))}</td>
                 <td class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(effectiveAmount))}</td>
              </tr>`;
      })
      .join("")}
              ${Array.from({ length: blankRowsNeeded }, renderBlankItemsRow).join("")}
            </tbody>
          </table>`;
};

const renderSummarySection = (


  orderEnquiry,
  bankData,
  upiData,

  grossAmount,

) => `
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
                        <td style="width:30%;" class="text-right" style="font-size:9px;">&#8377;${escapeHtml(formatCurrency(grossAmount))}</td>
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
          </table>`;

const renderTermsSection = (termConditions) =>
  termConditions.length > 0
    ? `
          <!-- TERMS & CONDITIONS -->
          <div class="terms-section">
            <p class="bold" style="font-size:9px; margin:2px 0;">Terms &amp; Conditions:</p>
            <ol style="font-size:9px;">
              ${termConditions.map((term) => `<li>${escapeHtml(term)}</li>`).join("")}
            </ol>
          </div>`
    : "";

const renderNoteAndSignature = (distributor) => `
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
          </table>`;

const renderChannelPartnersFooter = () => `
          <!-- CHANNEL PARTNERS FOOTER -->
          <div style="padding:4px 8px; border-top:1px solid #000;">
            <span style="font-size:9px; font-weight:bold; color:#555;">Channel Partners for:</span><br/>
            <div style="display:flex; align-items:center; justify-content:space-evenly; margin-top:3px; flex-wrap:wrap; gap:5px;">
              ${renderChannelPartnerImgs()}
            </div>
          </div>`;

const renderPageFooter = (pageNumber, totalPages, isLastPage) => `
          <!-- PAGE NUMBER / CONTINUATION NOTICE AT BOTTOM -->
          <div style="padding:3px 8px; text-align:center; font-size:9px; color:#555; border-top:1px solid #000;">
            ${isLastPage
    ? `Page ${pageNumber} of ${totalPages}`
    : `Continue to Page No. ${pageNumber + 1}`
  }
          </div>`;

const generateOrderEnquiryHTML = (orderEnquiry, options = {}) => {
  const distributor = orderEnquiry?.distributorId || {};
  const retailer = orderEnquiry?.retailerId || {};
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

  // Sort: product type ascending, then product name ascending within each type.
  validLineItems.sort((a, b) => {
    const typeCompare = String(a?.product?.product_type || "").localeCompare(
      String(b?.product?.product_type || ""),
      undefined,
      { sensitivity: "base" }
    );
    if (typeCompare !== 0) return typeCompare;

    return String(a?.product?.name || "").localeCompare(
      String(b?.product?.name || ""),
      undefined,
      { sensitivity: "base" }
    );
  });

  const grossAmount = validLineItems.reduce((total, item) => {
    return total + (Number(item?.taxableAmt) || 0);
  }, 0);




  // ---------------------------------------------------------------------
  // Split line items into pages dynamically (see paginateLineItems above).
  // Regular pages fill up to REGULAR_PAGE_ROWS; the final page — which also
  // carries the summary/terms/signature/footer block — only takes as many
  // rows as fit alongside that content. No blank "-" filler rows are added
  // anymore, so tables end where the real data ends instead of stretching
  // out to a fixed row count.
  // ---------------------------------------------------------------------
  const pages = paginateLineItems(validLineItems, termConditions.length);
  const totalPages = pages.length;

const pagesHtml = pages
  .map((itemsForPage, pageIndex) => {
    const isLastPage = pageIndex === totalPages - 1;
    const startIndex = pages
      .slice(0, pageIndex)
      .reduce((sum, p) => sum + p.length, 0);

    return `
      <div class="document-container" style="${isLastPage ? "" : "page-break-after: always;"}">
        ${renderCompanyHeader(distributor, options)}
        ${renderCustomerAndQuotationDetails(distributor, retailer, orderEnquiry)}
        ${renderItemsTable(itemsForPage, startIndex)}
        ${renderSummarySection(orderEnquiry, bankData, upiData, grossAmount)}
        ${renderTermsSection(termConditions)}
        ${renderNoteAndSignature(distributor)}
        ${renderChannelPartnersFooter()}
        ${renderPageFooter(pageIndex + 1, totalPages, isLastPage)}
      </div>`;
  })
  .join("\n");
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
        ${pagesHtml}
      </body>
    </html>
  `;
};

module.exports = generateOrderEnquiryHTML;