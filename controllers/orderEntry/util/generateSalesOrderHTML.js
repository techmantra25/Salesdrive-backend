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

const getStatusLabel = (status) => {
  if (status === "Completed_Billed") return "Completely Billed";
  if (status === "Partially_Billed") return "Partially Billed";
  return status || "Pending";
};

const generateSalesOrderHTML = (orderEntry, options = {}) => {
  const distributor = orderEntry?.distributorId || {};
  const retailer = orderEntry?.retailerId || {};
  const salesman = orderEntry?.salesmanName || {};
  const route = orderEntry?.routeId || {};
  const bankData = orderEntry?.bankData || {};
  const upiData = orderEntry?.upiData || {};
  const termConditions = Array.isArray(orderEntry?.termConditions)
    ? orderEntry.termConditions
    : [];
  const validLineItems = Array.isArray(orderEntry?.lineItems)
    ? orderEntry.lineItems.filter(
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
  const linkedBills = Array.isArray(orderEntry?.billIds)
    ? orderEntry.billIds
        .map((bill) => bill?.new_billno || bill?.billNo)
        .filter(Boolean)
    : [];

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sales Order - ${escapeHtml(orderEntry?.orderNo || "")}</title>
        <style>
          @page {
            size: A4;
            margin: 5mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            font-size: 9px;
            line-height: 1.2;
            color: #000;
            background: #fff;
          }
          .document-container {
            border: 1px solid #000;
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
          }
          .header-section {
            position: relative;
            text-align: center;
            padding: 8px 0 4px 0;
            border-bottom: 1px solid #000;
          }
          .logo-container {
            position: absolute;
            top: -5px;
            right: 10px;
            width: 80px;
          }
          .logo-container img {
            width: 100%;
            max-height: 60px;
            object-fit: contain;
          }
          .document-title {
            text-align: center;
            padding: 4px 0;
            border-bottom: 1px solid #000;
            background: #eef5ff;
          }
          .highlight-box {
            background: #fff9e6;
            border-left: 4px solid #ff9800;
            padding: 8px;
            margin: 5px;
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
            padding: 2px;
          }
          .left-section {
            width: 50%;
            border-right: 1px solid #000;
            padding: 4px;
          }
          .right-section {
            width: 50%;
            padding: 4px;
          }
          .items-table th {
            border-right: 1px solid #000;
            border-bottom: 1px solid #000;
            padding: 4px 2px;
            text-align: center;
            font-weight: bold;
            background: #f5f5f5;
          }
          .items-table td {
            border-right: 1px solid #000;
            border-bottom: 1px solid #eee;
            padding: 3px 2px;
          }
          .items-table th:last-child,
          .items-table td:last-child {
            border-right: none;
          }
          .border-top-bold {
            border-top: 2px solid #000;
          }
          .text-left {
            text-align: left;
          }
          .text-center {
            text-align: center;
          }
          .text-right {
            text-align: right;
          }
          .bold {
            font-weight: bold;
          }
          .terms-section {
            padding: 6px;
            border-bottom: 1px solid #000;
          }
          .terms-section ol {
            margin: 6px 0 0 18px;
            padding: 0;
          }
          .signature-table td {
            width: 50%;
            text-align: center;
            padding: 12px 8px;
          }
          .signature-line {
            border-top: 1px solid #000;
            width: 200px;
            margin: 40px auto 0 auto;
            padding-top: 5px;
          }
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="document-container">
          <div class="header-section">
            <div class="logo-container">
              <img
                src="${escapeHtml(
                  options?.logoBase64 ||
                    options?.logoUrl ||
                    "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1775744543343.png?alt=media",
                )}"
                alt="Company Logo"
                onerror="this.style.display='none'"
              />
            </div>
            <h2 style="margin: 0; font-size: 16px;">
              ${escapeHtml(distributor?.name || "Company Name")}
            </h2>
            <p style="margin: 3px 0;">
              ${escapeHtml(
                `${distributor?.address1 || ""}${
                  distributor?.address2 ? `, ${distributor.address2}` : ""
                }`,
              )}
            </p>
            <table style="margin-top: 3px;">
              <tbody>
                <tr>
                  <td style="width: 20%; text-align: left; padding-left: 20px;">
                    <strong>GSTIN No</strong>
                  </td>
                  <td style="width: 30%; text-align: left;">
                    : <strong>${escapeHtml(distributor?.gst_no || "")}</strong>
                  </td>
                  <td style="width: 20%; text-align: left;">
                    <strong>Email Id</strong>
                  </td>
                  <td style="width: 30%; text-align: left;">
                    : ${escapeHtml(distributor?.email || "")}
                  </td>
                </tr>
                <tr>
                  <td style="text-align: left; padding-left: 20px;">
                    <strong>State</strong>
                  </td>
                  <td style="text-align: left;">
                    : ${escapeHtml(distributor?.stateId?.name || "")}
                  </td>
                  <td style="text-align: left;">
                    <strong>Phone No.</strong>
                  </td>
                  <td style="text-align: left; font-weight: bold;">
                    : <strong>${escapeHtml(distributor?.phone || "")}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="document-title">
            <h3 style="margin: 0; font-size: 16px;">SALES ORDER</h3>
          </div>

          <table class="details-table">
            <tbody>
              <tr>
                <td class="left-section">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="2" class="bold">Retailer Details</td>
                      </tr>
                      <tr>
                        <td style="width: 30%;">Name</td>
                        <td>: <strong>${escapeHtml(
                          retailer?.outletName || "",
                        )}</strong>${retailer?.outletUID ? ` (${escapeHtml(retailer.outletUID)})` : ""}</td>
                      </tr>
                      <tr>
                        <td>Outlet Code</td>
                        <td>: ${escapeHtml(retailer?.outletCode || "")}</td>
                      </tr>
                      <tr>
                        <td>Address</td>
                        <td>: ${escapeHtml(
                          `${retailer?.address1 || ""}${
                            retailer?.city ? `, ${retailer.city}` : ""
                          }`,
                        )}</td>
                      </tr>
                      <tr>
                        <td>Village/City</td>
                        <td>: ${escapeHtml(retailer?.city || "")}</td>
                      </tr>
                      <tr>
                        <td>Pin Code</td>
                        <td>: ${escapeHtml(retailer?.pin || "")}</td>
                      </tr>
                      <tr>
                        <td>Phone No.</td>
                        <td>: <strong>${escapeHtml(retailer?.mobile1 || "")}</strong></td>
                      </tr>
                      <tr>
                        <td>GSTIN No.</td>
                        <td>: <strong>${escapeHtml(retailer?.gstin || "")}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td class="right-section">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="2" class="bold">Sales Order Details</td>
                      </tr>
                      <tr>
                        <td style="width: 34%;">Order No.</td>
                        <td>: <strong>${escapeHtml(
                          orderEntry?.orderNo || "",
                        )}</strong></td>
                      </tr>
                      ${
                        orderEntry?.orderId
                          ? `
                      <tr>
                        <td>External Order ID</td>
                        <td>: ${escapeHtml(orderEntry.orderId)}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td>Order Date</td>
                        <td>: ${escapeHtml(formatDate(orderEntry?.createdAt))}</td>
                      </tr>
                      <tr>
                        <td>Order Source</td>
                        <td>: ${escapeHtml(orderEntry?.orderSource || "")}</td>
                      </tr>
                      <tr>
                        <td>Order Type</td>
                        <td>: ${escapeHtml(orderEntry?.orderType || "")}</td>
                      </tr>
                      <tr>
                        <td>Payment Mode</td>
                        <td>: ${escapeHtml(orderEntry?.paymentMode || "")}</td>
                      </tr>
                      <tr>
                        <td>Sales Man</td>
                        <td>: ${escapeHtml(
                          salesman?.name || "",
                        )}${salesman?.empId ? ` (${escapeHtml(salesman.empId)})` : ""}</td>
                      </tr>
                      <tr>
                        <td>Beat</td>
                        <td>: ${escapeHtml(
                          route?.name || "",
                        )}${route?.code ? ` (${escapeHtml(route.code)})` : ""}</td>
                      </tr>
                      <tr>
                        <td>Status</td>
                        <td>: ${escapeHtml(getStatusLabel(orderEntry?.status))}</td>
                      </tr>
                      <tr>
                        <td>Linked Bill(s)</td>
                        <td>: <strong>${escapeHtml(
                          linkedBills.length ? linkedBills.join(", ") : "NA",
                        )}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          ${
            orderEntry?.remark
              ? `
          <div class="highlight-box">
            <strong>Remarks:</strong> ${escapeHtml(orderEntry.remark)}
          </div>
          `
              : ""
          }

          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 4%;">No</th>
                <th style="width: 24%;">Item Description</th>
                <th style="width: 8%;">HSN/SAC</th>
                <th style="width: 8%;">Qty PCS</th>
                <th style="width: 8%;">Qty BOX</th>
                <th style="width: 8%;">Basic Rate</th>
                <th style="width: 9%;">Gross Amt</th>
                <th style="width: 8%;">Scheme Amt</th>
                <th style="width: 9%;">Disc Amt</th>
                <th style="width: 7%;">Tax Amt</th>
                <th style="width: 7%;">Net Amt</th>
              </tr>
            </thead>
            <tbody>
              ${validLineItems
                .map((item, index) => {
                  const product = item?.product || {};
                  const description = `${product?.name || ""}`;

                  return `
              <tr>
                <td class="text-center">${index + 1}</td>
                <td class="text-left">${escapeHtml(description)}</td>
                <td class="text-center">${escapeHtml(
                  product?.product_hsn_code || "",
                )}</td>
                <td class="text-center">${Number(item?.oderQty) || 0}</td>
                <td class="text-center">${escapeHtml(
                  getBoxQty(product, item?.oderQty),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(item?.price?.rlp_price || 0),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(item?.grossAmt),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(item?.schemeDisc),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(item?.distributorDisc),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(getTaxAmount(item)),
                )}</td>
                <td class="text-right">${escapeHtml(
                  formatCurrency(item?.netAmt),
                )}</td>
              </tr>
                  `;
                })
                .join("")}
              ${emptyRows
                .map(
                  () => `
              <tr>
                <td class="text-center">-</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>

          <table class="summary-table">
            <tbody>
              <tr>
                <td class="left-section">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="3" class="bold">E & O.E</td>
                      </tr>
                      <tr>
                        <td colspan="2">Number of Items</td>
                        <td>: ${orderEntry?.totalLines || validLineItems.length}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Total Qty In PCS</td>
                        <td>: ${totalQtyPcs}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Total Qty In BOX</td>
                        <td>: ${formatCurrency(totalQtyBox)}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Order to Bill Status</td>
                        <td>: ${escapeHtml(getStatusLabel(orderEntry?.status))}</td>
                      </tr>
                      ${
                        Number(orderEntry?.totalBasePoints) > 0
                          ? `
                      <tr>
                        <td colspan="2">Base Points</td>
                        <td>: ${Number(orderEntry.totalBasePoints) || 0}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td colspan="3" style="padding-top: 10px;">
                          <strong>Amount In Words:</strong>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="3" class="bold">
                          ${escapeHtml(
                            formatAmountInWords(orderEntry?.netAmount),
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td class="right-section">
                  <table>
                    <tbody>
                      <tr>
                        <td style="width: 60%;">Gross Amount</td>
                        <td style="width: 10%;" class="text-center">:</td>
                        <td style="width: 30%;" class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.grossAmount),
                        )}</td>
                      </tr>
                      <tr>
                        <td>Scheme Discount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.schemeDiscount),
                        )}</td>
                      </tr>
                      <tr>
                        <td>Distributor Discount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.distributorDiscount),
                        )}</td>
                      </tr>
                      <tr>
                        <td>Taxable Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.taxableAmount),
                        )}</td>
                      </tr>
                      <tr>
                        <td>CGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.cgst),
                        )}</td>
                      </tr>
                      <tr>
                        <td>SGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.sgst),
                        )}</td>
                      </tr>
                      ${
                        Number(orderEntry?.igst) > 0
                          ? `
                      <tr>
                        <td>IGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.igst),
                        )}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td>Invoice Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.invoiceAmount),
                        )}</td>
                      </tr>
                      <tr>
                        <td>Round Off Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.roundOffAmount),
                        )}</td>
                      </tr>
                      ${
                        Number(orderEntry?.cashDiscount) > 0 ||
                        orderEntry?.cashDiscountApplied
                          ? `
                      <tr>
                        <td>Cash Discount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.cashDiscount),
                        )}</td>
                      </tr>
                      `
                          : ""
                      }
                      ${
                        Number(orderEntry?.creditAmount) > 0
                          ? `
                      <tr>
                        <td>Credit Note Adjustment</td>
                        <td class="text-center">:</td>
                        <td class="text-right">${escapeHtml(
                          formatCurrency(orderEntry?.creditAmount),
                        )}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr class="bold border-top-bold" style="font-weight: bold;">
                        <td style="padding-top: 5px;">Net Amount</td>
                        <td class="text-center" style="padding-top: 5px;">:</td>
                        <td class="text-right" style="padding-top: 5px;">${escapeHtml(
                          formatCurrency(orderEntry?.netAmount),
                        )}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          ${
            bankData?.bankName || upiData?.upiId
              ? `
          <table class="bank-table">
            <tbody>
              <tr>
                <td style="width: 70%; padding: 4px; vertical-align: top;">
                  <table>
                    <tbody>
                      <tr>
                        <td colspan="3" class="bold">Bank Details</td>
                      </tr>
                      ${
                        bankData?.bankName
                          ? `
                      <tr>
                        <td style="width: 30%;">Bank Name</td>
                        <td>: ${escapeHtml(bankData.bankName)}</td>
                      </tr>
                      <tr>
                        <td>Branch</td>
                        <td>: ${escapeHtml(bankData.branchCode || "")}</td>
                      </tr>
                      <tr>
                        <td>IFSC Code</td>
                        <td>: ${escapeHtml(bankData.ifscCode || "")}</td>
                      </tr>
                      <tr>
                        <td>Account Type</td>
                        <td>: ${escapeHtml(bankData.accountType || "")}</td>
                      </tr>
                      <tr>
                        <td>Account Number</td>
                        <td>: ${escapeHtml(bankData.accountNumber || "")}</td>
                      </tr>
                      `
                          : `
                      <tr>
                        <td colspan="2">Bank details are not available.</td>
                      </tr>
                      `
                      }
                    </tbody>
                  </table>
                </td>
                <td style="width: 30%; padding: 4px; vertical-align: top;">
                  <table>
                    <tbody>
                      <tr>
                        <td class="bold">UPI Details</td>
                      </tr>
                      <tr>
                        <td>${escapeHtml(
                          upiData?.upiId
                            ? `UPI ID: ${upiData.upiId}`
                            : "UPI details are not available.",
                        )}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
          `
              : ""
          }

          ${
            termConditions.length > 0
              ? `
          <div class="terms-section">
            <p class="bold">Terms & Conditions:</p>
            <ol>
              ${termConditions
                .map((term) => `<li>${escapeHtml(term)}</li>`)
                .join("")}
            </ol>
          </div>
          `
              : `
          <div class="terms-section">
            <p><strong>Note:</strong> This is a system generated sales order print.</p>
          </div>
          `
          }

          <table class="signature-table">
            <tbody>
              <tr>
                <td>
                  <p class="bold">Accepted By Customer</p>
                  <div class="signature-line"></div>
                </td>
                <td>
                  <p class="bold">For ${escapeHtml(
                    distributor?.name || "Company Name",
                  )}</p>
                  <div class="signature-line">
                    <p class="bold">Authorised Signatory</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
};

module.exports = generateSalesOrderHTML;
