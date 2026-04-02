// File: generateSalesReturnHTML.js

const generateSalesReturnHTML = (salesReturn, options = {}) => {
  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Helper to calculate days difference
  const getDaysDifference = (billDate, returnDate) => {
    if (!billDate || !returnDate) return 0;
    const diff = new Date(returnDate) - new Date(billDate);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Helper to get box quantity
  const getBoxQty = (item, qtyNumber) => {
    const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box) || 1;
    let qty = qtyNumber;
    return (qty / piecesPerBox).toFixed(2);
  };

  // Helper function to format currency
  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return "0.00";
    return parseFloat(amount).toFixed(2);
  };

  // Helper to convert amount to words (placeholder)
  const convertToWords = (amount) => {
    // Implement actual conversion or import from your utils
    return `Rupees ${Math.floor(amount)} Only`;
  };

  const distributor = salesReturn.distributorId;
  const outlet = salesReturn.retailerId;
  const salesman = salesReturn.salesmanName;
  const route = salesReturn.routeId;
  const bill = salesReturn.billId;
  const bank = salesReturn.bankData;
  const termConditions = salesReturn.termConditions || [];

  // Filter line items
  const validLineItems = (salesReturn?.lineItems || []).filter(
    (item) => item?.returnQty > 0,
  );

  // Group items by return type
  const creditNoteItems = validLineItems.filter(
    (item) => item.salesReturnType === "Credit Note",
  );
  const replacementItems = validLineItems.filter(
    (item) => item.salesReturnType === "Replacement",
  );
  const noCreditItems = validLineItems.filter(
    (item) => item.salesReturnType === "No Credit Note",
  );

  // Generate empty rows for minimum 15 lines
  const emptyRows = Array.from({
    length: Math.max(0, 15 - validLineItems.length),
  });

  // Calculate days since bill
  const daysSinceBill = getDaysDifference(
    bill?.createdAt,
    salesReturn?.createdAt,
  );

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sales Return - ${salesReturn.salesReturnNo}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: Arial, sans-serif;
          font-size: 10px;
          line-height: 1.4;
          color: #000;
          background: #fff;
        }
        
        .container {
          border: 1px solid #000;
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
        }
        
        .header {
          position: relative;
          padding: 10px 0 5px 0;
          border-bottom: 1px solid #000;
          text-align: center;
        }
        
        .logo {
          position: absolute;
          top: -7px;
          right: 10px;
          width: 100px;
        }
        
        .logo img {
          width: 100%;
          max-height: 80px;
          object-fit: contain;
        }
        
        .header h2 {
          margin: 0;
          font-size: 18px;
        }
        
        .header p {
          margin: 5px 0;
        }
        
        .header-table {
          width: 100%;
          margin-top: 5px;
        }
        
        .header-table td {
          padding: 2px;
        }
        
        .invoice-title {
          text-align: center;
          padding: 5px 0;
          border-bottom: 1px solid #000;
          background-color: #fff5f5;
        }
        
        .invoice-title h3 {
          margin: 0;
          font-size: 16px;
          color: #d32f2f;
        }
        
        .details-section {
          width: 100%;
          border-collapse: collapse;
          border-bottom: 1px solid #000;
        }
        
        .details-section td {
          padding: 2px;
          vertical-align: top;
        }
        
        .left-section {
          width: 50%;
          border-right: 1px solid #000;
          padding: 5px;
        }
        
        .right-section {
          width: 50%;
          padding: 5px;
        }
        
        .items-table {
          width: 100%;
          border-collapse: collapse;
          border-bottom: 1px solid #000;
        }
        
        .items-table th {
          border-right: 1px solid #000;
          border-bottom: 1px solid #000;
          padding: 4px 2px;
          text-align: center;
          white-space: pre-line;
          background-color: #f5f5f5;
          font-size: 9px;
          font-weight: bold;
        }
        
        .items-table th:last-child {
          border-right: none;
        }
        
        .items-table td {
          border-right: 1px solid #000;
          padding: 3px 2px;
          border-bottom: 1px solid #eee;
          font-size: 9px;
        }
        
        .items-table td:last-child {
          border-right: none;
        }
        
        .summary-section {
          width: 100%;
          border-collapse: collapse;
          border-bottom: 1px solid #000;
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
        
        .status-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: bold;
          font-size: 8px;
          white-space: nowrap;
        }
        
        .badge-salable {
          background-color: #d4edda;
          color: #155724;
        }
        
        .badge-unsalable {
          background-color: #f8d7da;
          color: #721c24;
        }
        
        .badge-credit {
          background-color: #d1ecf1;
          color: #0c5460;
        }
        
        .badge-replacement {
          background-color: #fff3cd;
          color: #856404;
        }
        
        .badge-no-credit {
          background-color: #e2e3e5;
          color: #383d41;
        }
        
        .bank-details {
          padding: 5px;
          border-bottom: 1px solid #000;
        }
        
        .terms-section {
          padding: 5px;
          border-bottom: 1px solid #000;
        }
        
        .terms-section ol {
          margin: 5px 0 5px 25px;
          padding: 0;
        }
        
        .signature-section {
          width: 100%;
          border-collapse: collapse;
          padding: 10px 0;
        }
        
        .signature-section td {
          width: 50%;
          text-align: center;
          vertical-align: top;
          padding: 10px;
        }
          
        .signature-line {
          border-top: 1px solid #000;
          width: 200px;
          margin: 60px auto 0 auto;
          padding-top: 5px;
        }
        
        .footer {
          text-align: center;
          padding: 2px;
          border-top: 1px solid #000;
        }
        
        .highlight-box {
          background-color: #fff9e6;
          border-left: 4px solid #ff9800;
          padding: 8px;
          margin: 5px 0;
        }
        
        .border-top-bold {
          border-top: 2px solid #000;
        }
        
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          
          .container {
            border: 2px solid #000;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <div class="header">
          <div class="logo">
            <img
              src="${options.logoBase64 || "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1749812986881.png?alt=media"}"
              alt="Company Logo"
              onerror="this.style.display='none'"
            />
          </div>
          
          <h2>${distributor?.name || "Company Name"}</h2>
          <p>${distributor?.address1 || ""}${distributor?.address2 ? ", " + distributor?.address2 : ""}</p>
          
          <table class="header-table">
            <tbody>
              <tr>
                <td style="width: 20%; text-align: left; padding-left: 20px;">
                  <strong>GSTIN No</strong>
                </td>
                <td style="width: 30%; text-align: left;">
                  : ${distributor?.gst_no || ""}
                </td>
                <td style="width: 20%; text-align: left;">
                  <strong>Email Id</strong>
                </td>
                <td style="width: 30%; text-align: left;">
                  : ${distributor?.email || ""}
                </td>
              </tr>
              <tr>
                <td style="text-align: left; padding-left: 20px;">
                  <strong>State</strong>
                </td>
                <td style="text-align: left;">
                  : ${distributor?.stateId?.name || ""}${
                    distributor?.stateId?.slug && distributor?.stateId?.code
                      ? ` (${distributor?.stateId?.slug}) (${distributor?.stateId?.code})`
                      : ""
                  }
                </td>
                <td style="text-align: left;">
                  <strong>Phone No.</strong>
                </td>
                <td style="text-align: left;">
                  : ${distributor?.phone || ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Invoice Title -->
        <div class="invoice-title">
          <h3>SALES RETURN</h3>
        </div>

        <!-- Return Details and Retailer Info -->
        <table class="details-section">
          <tbody>
            <tr>
              <!-- Left: Retailer Details -->
              <td class="left-section">
                <table style="width: 100%;">
                  <tbody>
                    <tr>
                      <td colspan="2" class="bold">Retailer Details</td>
                    </tr>
                    <tr>
                      <td style="width: 30%;">Name</td>
                      <td>: ${outlet?.outletName || ""}${outlet?.outletUID ? ` (${outlet.outletUID})` : ""}</td>
                    </tr>
                    <tr>
                      <td>Address</td>
                      <td>: ${outlet?.address1 || ""}${outlet?.city ? ", " + outlet.city : ""}</td>
                    </tr>
                    <tr>
                      <td>Village/City</td>
                      <td>: ${outlet?.city || ""}</td>
                    </tr>
                    <tr>
                      <td>Pin Code</td>
                      <td>: ${outlet?.pin || ""}</td>
                    </tr>
                    <tr>
                      <td>Phone No.</td>
                      <td>: ${outlet?.mobile1 || ""}</td>
                    </tr>
                    <tr>
                      <td>GSTIN No.</td>
                      <td>: ${outlet?.gstin || ""}</td>
                    </tr>
                  </tbody>
                </table>
              </td>

              <!-- Right: Return Info -->
              <td class="right-section">
                <table style="width: 100%;">
                  <tbody>
                  <tr>
                      <td colspan="2" class="bold">Sales Return Details</td>
                    </tr>
                    <tr>
                      <td style="width: 30%;">Sales Return No.</td>
                      <td>: ${salesReturn.salesReturnNo}</td>
                    </tr>
                    <tr>
                      <td>Return Date</td>
                      <td>: ${formatDate(salesReturn.createdAt)}</td>
                    </tr>
                    <tr>
                      <td>Reference Bill No.</td>
                      <td>: ${bill?.billNo || ""}</td>
                    </tr>
                    <tr>
                      <td>Bill Date</td>
                      <td>: ${formatDate(bill?.createdAt)}</td>
                    </tr>
                    <tr>
                      <td>Days Since Bill</td>
                      <td>: ${daysSinceBill} days ${daysSinceBill > 90 ? "(Exceeds 90)" : "(Max 90)"}</td>
                    </tr>
                    <tr>
                      <td>Sales Man</td>
                      <td>: ${salesman?.name || ""}${salesman?.empId ? ` (${salesman.empId})` : ""}</td>
                    </tr>
                    <tr>
                      <td>Route</td>
                      <td>: ${route?.beat_name || route?.name || ""}${route?.code ? ` (${route.code})` : ""}</td>
                    </tr>      
                    ${
                      salesReturn.collectionStatus
                        ? `
                    <tr>
                      <td>Collection Status</td>
                      <td>: ${salesReturn.collectionStatus}</td>
                    </tr>
                    `
                        : ""
                    }
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        ${
          salesReturn.remarks
            ? `
        <div class="highlight-box">
          <strong>Remarks:</strong> ${salesReturn.remarks}
        </div>
        `
            : ""
        }

        <!-- Items Table -->
        <div>
          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 5%;">Sr.<br/>No.</th>
                <th style="width: 20%; text-align: left;">Item Description</th>
                <th style="width: 7%;">UOM</th>
                <th style="width: 7%;">Bill<br/>Qty</th>
                <th style="width: 7%;">Return<br/>Qty</th>
                <th style="width: 9%;">Basic Rate</th>
                <th style="width: 10%;">Gross<br/>Amt</th>
                <th style="width: 10%;">Scheme<br/>Disc</th>
                <th style="width: 10%;">Taxable<br/>Amt</th>
                <th style="width: 10%;">TAX Amount</th>
                <th style="width: 10%;">Net<br/>Amt</th>
              </tr>
            </thead>
            <tbody>
              ${validLineItems
                .map((item, index) => {
                  const product = item.product || {};
                  const returnTypeBadge =
                    item.salesReturnType === "Credit Note"
                      ? "badge-credit"
                      : item.salesReturnType === "Replacement"
                        ? "badge-replacement"
                        : "badge-no-credit";
                  const returnTypeShort =
                    item.salesReturnType === "Credit Note"
                      ? "Credit Note"
                      : item.salesReturnType === "Replacement"
                        ? "Replace"
                        : "No Credit";

                  return `
              <tr>
                <td class="text-center">${index + 1}</td>
                <td class="text-left">${product.name || ""}</td>
                <td class="text-center">${(item.uom || "").toUpperCase()}</td>
                <td class="text-center">${item.billQty || 0}</td>
                <td class="text-center">${item.returnQty || 0}</td>
                <td class="text-right">₹${formatCurrency(item.price?.rlp_price || 0)}</td>
                <td class="text-right">₹${formatCurrency(item.grossAmt)}</td>
                <td class="text-right">₹${formatCurrency(item.schemeDisc)}</td>
                <td class="text-right">₹${formatCurrency(item.taxableAmt)}</td>
                <td class="text-right">₹${formatCurrency(item.totalCGST + item.totalSGST + item.totalIGST)}</td>
                <td class="text-right">₹${formatCurrency(item.netAmt)}</td>
              </tr>
              `;
                })
                .join("")}

              ${emptyRows
                .map(
                  (_, index) => `
              <tr>
                <td class="text-center">-</td>
                <td class="text-left"></td>
                <td class="text-center"></td>
                <td class="text-center"></td>
                <td class="text-center"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
                <td class="text-right"></td>
              </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>

        <!-- Summary Section -->
        <table class="summary-section">
          <tbody>
            <tr>
              <!-- Left Side: Return Summary -->
              <td class="left-section">
                <table style="width: 100%;">
                  <tbody>
                    <tr>
                      <td colspan="3" class="bold">E & O.E</td>
                    </tr>
                    <tr>
                      <td colspan="2">Total Items Returned</td>
                      <td>: ${validLineItems.length}</td>
                    </tr>
                    <tr>
                      <td colspan="2">Total Return Qty (PCS)</td>
                      <td>: ${validLineItems.reduce(
                        (sum, item) => sum + (item.returnQty || 0),
                        0,
                      )}</td>
                    </tr>
                    ${
                      creditNoteItems.length > 0
                        ? `
                    <tr>
                      <td colspan="2">Items for Credit Note</td>
                      <td>: ${creditNoteItems.length}</td>
                    </tr>
                    `
                        : ""
                    }
                    ${
                      replacementItems.length > 0
                        ? `
                    <tr>
                      <td colspan="2">Items for Replacement</td>
                      <td>: ${replacementItems.length}</td>
                    </tr>
                    `
                        : ""
                    }
                    ${
                      noCreditItems.length > 0
                        ? `
                    <tr>
                      <td colspan="2">Items - No Credit</td>
                      <td>: ${noCreditItems.length}</td>
                    </tr>
                    `
                        : ""
                    }
                    ${
                      salesReturn.totalBasePoints > 0
                        ? `
                    <tr>
                      <td colspan="2">Base Points Deducted</td>
                      <td>: ${salesReturn.totalBasePoints}</td>
                    </tr>
                    `
                        : ""
                    }
                    <tr>
                      <td colspan="2" style="padding-top: 5px;">
                        Amount In Words
                      </td>
                      <td style="padding-top: 5px;">: ${convertToWords(salesReturn.netAmount || 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>

              <!-- Right Side: Financial Summary -->
              <td class="right-section">
                <table style="width: 100%;">
                  <tbody>
                    <tr>
                      <td style="width: 60%;">Gross Amount</td>
                      <td style="width: 10%;" class="text-center">:</td>
                      <td style="width: 30%;" class="text-right">₹${formatCurrency(
                        salesReturn.grossAmount,
                      )}</td>
                    </tr>
                    <tr>
                      <td>Scheme Discount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.schemeDiscount,
                      )}</td>
                    </tr>
                    <tr>
                      <td>Distributor Discount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.distributorDiscount,
                      )}</td>
                    </tr>
                    <tr>
                      <td>Taxable Amount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.taxableAmount,
                      )}</td>
                    </tr>
                    <tr>
                      <td>CGST</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(salesReturn.cgst)}</td>
                    </tr>
                    <tr>
                      <td>SGST</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(salesReturn.sgst)}</td>
                    </tr>
                    ${
                      salesReturn.igst > 0
                        ? `
                    <tr>
                      <td>IGST</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(salesReturn.igst)}</td>
                    </tr>
                    `
                        : ""
                    }
                    <tr>
                      <td>Invoice Amount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.invoiceAmount,
                      )}</td>
                    </tr>
                    ${
                      salesReturn.roundOffAmount !== 0
                        ? `
                    <tr>
                      <td>Round of Amount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.roundOffAmount,
                      )}</td>
                    </tr>
                    `
                        : ""
                    }
                    ${
                      salesReturn.cashDiscount > 0
                        ? `
                    <tr>
                      <td>Cash Discount</td>
                      <td class="text-center">:</td>
                      <td class="text-right">₹${formatCurrency(
                        salesReturn.cashDiscount,
                      )}</td>
                    </tr>
                    `
                        : ""
                    }
                    <tr class="bold border-top-bold">
                      <td style="padding-top: 5px;">Net Amount</td>
                      <td class="text-center" style="padding-top: 5px;">:</td>
                      <td class="text-right" style="padding-top: 5px;">₹${formatCurrency(
                        salesReturn.netAmount,
                      )}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Bank Details -->
        ${
          bank
            ? `
        <div class="bank-details">
          <p class="bold">Bank Details:</p>
          <table style="width: 100%; margin-top: 5px;">
            <tbody>
              <tr>
                <td style="width: 30%;">Bank Name</td>
                <td>: ${bank.bankName || ""}</td>
                <td style="width: 30%;">Account Type</td>
                <td>: ${bank.accountType || ""}</td>
              </tr>
              <tr>
                <td>Branch</td>
                <td>: ${bank.branchCode || ""}</td>
                <td>Account Number</td>
                <td>: ${bank.accountNumber || ""}</td>
              </tr>
              <tr>
                <td>IFSC Code</td>
                <td>: ${bank.ifscCode || ""}</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        `
            : ""
        }

        <!-- Terms & Conditions -->
        ${
          termConditions.length > 0
            ? `
        <div class="terms-section">
          <p class="bold">Terms & Conditions:</p>
          <ol>
            ${termConditions.map((term) => `<li>${term}</li>`).join("")}
          </ol>
        </div>
        `
            : ""
        }

        <!-- Signature Section -->
        <table class="signature-section">
          <tbody>
            <tr>
              <td>
                <p class="bold">RECEIVED THE RETURNED MATERIAL IN GOOD CONDITION</p>
                <div class="signature-line">
                  <p class="bold">RECEIVER'S SIGNATURE AND SEAL</p>
                </div>
              </td>
              <td>
                <p class="bold">For ${distributor?.name || "Company Name"}</p>
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

module.exports = generateSalesReturnHTML;
