const numberToWords = require("./numberToWords");
const QRCode = require("qrcode");

/**
 * Generates HTML for a bill/invoice using the provided bill object
 * @param {Object} bill - The bill object containing all invoice data
 * @param {Object} options - Additional options for layout
 * @returns {string} - HTML string for the invoice
 */
async function generateBillHTML(bill, options = {}) {
  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Format currency
  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return "0.00";
    return parseFloat(amount).toFixed(2);
  };

  // Get box quantity calculation
  const getBoxQty = (item, qtyNumber) => {
    const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box) || 1;
    let qty = qtyNumber;
    return (qty / piecesPerBox).toFixed(2);
  };

  // Get distributor details
  const distributor = bill.distributorId || {};

  // Get bank data
  const bankData = bill.bankData || {};

  // Get UPI data from bill object (already fetched in controller)
  const upiData = bill.upiData || null;

  // Get retailer details
  const retailer = bill.retailerId || {};

  // Get order details
  const order = bill.orderId || {};

  // Get salesman details
  const salesman = bill.salesmanName || {};

  // Get route details
  const route = bill.routeId || {};

  // Get Terms & Conditions
  const termConditions = bill.termConditions || [];

  // Filter valid line items
  const validLineItems = (bill.lineItems || []).filter(
    (item) => item?.billQty > 0,
  );

  // Generate UPI QR Code
  const generateUpiQR = async (upiId) => {
    if (!upiId) return "";

    try {
      // Generate QR code as data URL
      const qrDataUrl = await QRCode.toDataURL(
        `upi://pay?pa=${upiId}&pn=Payment`,
      );
      return qrDataUrl;
    } catch (error) {
      console.error("QR Code generation error:", error);
      return "";
    }
  };

  // Generate QR code if UPI data exists
  let upiQRCode = "";
  if (upiData?.upiId) {
    upiQRCode = await generateUpiQR(upiData.upiId);
  }

  // Generate Terms & Conditions HTML
  let termConditionsHTML = "";
  termConditions.forEach((term, index) => {
    termConditionsHTML += `<li>${term}</li>`;
  });

  // Generate line items HTML
  let lineItemsHTML = "";
  validLineItems.forEach((item, index) => {
    const product = item.product || {};

    lineItemsHTML += `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">
          ${index + 1}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: left;">
          ${(product.name || "").replace(
            /\b\d{3}\b/g,
            "<strong>$&</strong>",
          )} ${product.product_code || ""}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">
          ${product.product_hsn_code || ""}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">
          ${item.billQty || 0}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">
          ${getBoxQty(item, item.billQty) || 1}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">
          ${formatCurrency(item.price?.rlp_price || 0)}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">
          ${formatCurrency(item.grossAmt)}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">
          ${formatCurrency(item.schemeDisc)}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">
          ${formatCurrency(item.distributorDisc)}
        </td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">
          ${formatCurrency(item.totalCGST + item.totalSGST + item.totalIGST)}
        </td>
        <td style="padding: 2px; font-weight: bold; text-align: right;">
          ${formatCurrency(item.netAmt)}
        </td>
      </tr>
    `;
  });

  // Fill empty rows to reach 30 total rows for consistent layout
  const emptyRowsCount = Math.max(0, 28 - validLineItems.length);
  for (let i = 0; i < emptyRowsCount; i++) {
    lineItemsHTML += `
      <tr>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">-</td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="border-right: 1px solid #000; padding: 2px;"></td>
        <td style="padding: 2px;"></td>
      </tr>
    `;
  }

  // Get amount in words
  const amountInWords = () => {
    const amount = bill.netAmount || 0;
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);

    let result = numberToWords(rupees) + " Rupees";
    if (paise > 0) {
      result += " and " + numberToWords(paise) + " Paise";
    }
    return result + " Only";
  };

  // Generate the HTML
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>
      ${
        bill.new_billno || bill.billNo
          ? `Invoice_${bill.new_billno || bill.billNo}`
          : "Invoice"
      }
    </title>
    <style>
      @page {
        size: A4;
        margin: 5mm 5mm 5mm 5mm;
      }
      * {
        box-sizing: border-box;
      }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        font-size: 9px;
        line-height: 1.1;
        color: #000;
      }
      .invoice-container {
        border: 1px solid #000;
        max-width: 900px;
        margin: 0 auto;
        background: white;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
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
      .invoice-title {
        text-align: center;
        padding: 4px 0;
        border-bottom: 1px solid #000;
      }
      .billing-details {
        page-break-inside: avoid;
      }
      .items-section {
        flex-grow: 1;
      }
      .items-table {
        width: 100%;
        border-collapse: collapse;
      }
      .items-table thead {
        display: table-header-group;
      }
      .summary-section {
        page-break-inside: avoid;
      }
      .bank-details {
        page-break-inside: avoid;
      }
      .terms-conditions {
        page-break-inside: avoid;
      }
      .signature-section {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      table {
        page-break-inside: auto;
      }
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      th,
      td {
        page-break-inside: avoid;
      }
      h2,
      h3 {
        margin: 0;
      }
      p {
        margin: 4px 0;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .invoice-container {
          border: 1px solid #000 !important;
          min-height: auto;
        }
        table,
        th,
        td {
          border-color: #000 !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="invoice-container">
      <!-- Header Section -->
      <div class="header-section">
        <!-- Top Right Logo -->
        <div class="logo-container">
          <img
            src="${options.logoBase64 || "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1775744543343.png?alt=media"}"
            alt="Company Logo"
            onerror="this.style.display='none'"
          />
        </div>
        <h2 style="margin: 0; font-size: 16px">
          ${distributor.name || "Company Name"}
        </h2>
        <p style="margin: 3px 0; font-size: 9px">
          ${distributor.address1 || ""}, ${distributor.address2 || ""}
        </p>
        <table style="width: 100%; margin-top: 3px; font-size: 9px">
          <tbody>
            <tr>
              <td style="width: 20%; text-align: left; padding-left: 20px">
                <strong>GSTIN No</strong>
              </td>
              <td style="width: 30%; text-align: left">
                : ${distributor.gst_no || ""}
              </td>
              <td style="width: 20%; text-align: left">
                <strong>Email Id</strong>
              </td>
              <td style="width: 30%; text-align: left">
                : ${distributor.email || ""}
              </td>
            </tr>
            <tr>
              <td style="text-align: left; padding-left: 20px">
                <strong>State</strong>
              </td>
              <td style="text-align: left">
                : ${distributor?.stateId?.name || ""}${
                  distributor?.stateId?.slug && distributor?.stateId?.code
                    ? ` (${distributor?.stateId?.slug}) (${distributor?.stateId?.code})`
                    : ""
                }
              </td>
              <td style="text-align: left">
                <strong>Phone No.</strong>
              </td>
              <td style="text-align: left; font-weight: bold">: ${distributor.phone || ""}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Invoice Title -->
      <div class="invoice-title">
        <h3 style="margin: 0; font-size: 16px">TAX INVOICE</h3>
      </div>

      <!-- Billing and Invoice Details -->
      <div class="billing-details">
        <table
          style="
            width: 100%;
            border-collapse: collapse;
            border-bottom: 1px solid #000;
          "
        >
          <tbody>
            <tr>
              <!-- Billing Details -->
              <td
                style="
                  width: 50%;
                  padding: 2px;
                  border-right: 1px solid #000;
                  vertical-align: top;
                "
              >
                <table style="width: 100%">
                  <tbody>
                    <tr>
                      <td colspan="2" style="font-weight: bold">
                        Billing Details (Bill To)
                      </td>
                    </tr>
                    <tr>
                      <td>Name</td>
                      <td style="font-weight: bold">
                        : ${retailer?.outletName || ""} (${
                          retailer?.outletUID || ""
                        })
                      </td>
                    </tr>
                    <tr>
                      <td>Address</td>
                      <td>
                        : ${retailer.address1 || ""}, ${retailer.city || ""}
                      </td>
                    </tr>
                    <tr>
                      <td>Village/City</td>
                      <td>: ${retailer.city || ""}</td>
                    </tr>
                    <tr>
                      <td>Pin Code</td>
                      <td>: ${retailer.pin || ""}</td>
                    </tr>
                  </tbody>
                </table>
              </td>

              <!-- Invoice Details -->
              <td style="width: 50%; padding: 2px; vertical-align: top">
                <table style="width: 100%">
                  <tbody>
                    <tr>
                      <td style="width: 20%">Invoice No.</td>
                      <td style="font-weight: bold">: ${bill.new_billno || bill.billNo}</td>
                    </tr>
                    <tr>
                      <td style="width: 20%">Order No.</td>
                      <td>: ${order?.orderNo || ""}</td>
                    </tr>
                    <tr>
                      <td>Sales Man</td>
                      <td>
                        : ${salesman.name || ""} (${salesman?.empId || ""})
                      </td>
                    </tr>
                    <tr>
                      <td>Beat</td>
                      <td>: ${route.name || ""} (${route?.code || ""})</td>
                    </tr>
                    <tr>
                      <td>Phone No.</td>
                      <td style="font-weight: bold">: ${retailer.mobile1 || ""}</td>
                    </tr>
                    <tr>
                      <td>GSTIN No.</td>
                      <td>: ${retailer.gstin || ""}</td>
                    </tr>
                    <tr>
                      <td>Date</td>
                      <td style="font-weight: bold">: ${formatDate(bill?.createdAt)}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Items Table -->
      <div class="items-section">
        <table class="items-table" style="border-bottom: 1px solid #000">
          <thead>
            <tr style="border-bottom: 1px solid #000">
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                No
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: left;
                "
              >
                Item Description
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                HSN/SAC
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Qty<br />PCS
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Qty<br />BOX
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Basic<br />Rate
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Gross<br />Amount
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Scheme<br />Amount
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Distributor<br />Disc Amt
              </th>
              <th
                style="
                  border-right: 1px solid #000;
                  padding: 2px;
                  text-align: center;
                "
              >
                Tax Amount
              </th>
              <th style="padding: 2px; text-align: center">Net Amount</th>
            </tr>
          </thead>
          <tbody">
            ${lineItemsHTML}
          </tbody>
        </table>
      </div>

      <!-- Summary Section -->
      <div class="summary-section">
        <table
          style="
            width: 100%;
            border-collapse: collapse;
            border-top: 1px solid #000;
          "
        >
          <tbody>
            <tr>
              <!-- Left Side -->
              <td
                style="
                  width: 50%;
                  padding: 2px;
                  
                  vertical-align: top;
                "
              >
                <table style="width: 100%">
                  <tbody>
                    <tr>
                      <td colspan="3" style="font-weight: bold">E & O.E</td>
                    </tr>
                    ${
                      distributor?.RBPSchemeMapped === "yes"
                        ? `
                    <tr>
                      <td colspan="2">
                        Total points accrued at the time of this invoice
                        creation
                      </td>
                      <td>: ${bill?.totalBasePoints || 0}</td>
                    </tr>
                    <tr>
                      <td colspan="2">Points in this Invoice</td>
                      <td>: ${bill?.totalBasePoints || 0}</td>
                    </tr>
                    `
                        : ""
                    }
                    <tr>
                      <td colspan="2">Number of Items</td>
                      <td>: ${bill?.totalLines || 0}</td>
                    </tr>
                    <tr>
                      <td colspan="2">Total Qty In PCS :</td>
                      <td>
                        : ${validLineItems.reduce(
                          (sum, item) => sum + (item.billQty || 0),
                          0,
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td colspan="3" style="padding-top: 10px">
                        Amount In Words :
                      </td>
                    </tr>
                    <tr>
                      <td colspan="3" style="font-weight: bold">
                        ${amountInWords()}
                      </td>
                    </tr>
                    ${
                      distributor?.RBPSchemeMapped === "yes"
                        ? `
                    <tr>
                      <td colspan="3" style="padding-top: 10px">
                        Retailer Current Point Balance:
                      </td>
                    </tr>
                    <tr>
                      <td colspan="3" style="font-weight: bold">
                        ${retailer?.currentPointBalance} Points
                      </td>
                    </tr>
                    `
                        : ""
                    }
                  </tbody>
                </table>
              </td>

              <!-- Right Side -->
              <td style="width: 50%; padding: 2px; vertical-align: top">
                <table style="width: 100%">
                  <tbody>
                    <tr>
                      <td style="width: 60%">Gross Amount :</td>
                      <td style="width: 10%; text-align: center">:</td>
                      <td style="width: 30%; text-align: right">
                        ${formatCurrency(bill?.grossAmount)}
                      </td>
                    </tr>
                    <tr>
                      <td>Scheme Discount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.schemeDiscount)}
                      </td>
                    </tr>
                    <tr>
                      <td>Discount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.distributorDiscount)}
                      </td>
                    </tr>
                    <tr>
                      <td>Taxable Amount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.taxableAmount)}
                      </td>
                    </tr>
                    <tr>
                      <td>CGST</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.cgst)}
                      </td>
                    </tr>
                    <tr>
                      <td>SGST</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.sgst)}
                      </td>
                    </tr>
                    <tr>
                      <td>IGST</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.igst)}
                      </td>
                    </tr>
                    <tr>
                      <td>Invoice Amount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.invoiceAmount)}
                      </td>
                    </tr>
                    <tr>
                      <td>Round of Amount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.roundOffAmount)}
                      </td>
                    </tr>
                    <tr>
                      <td>Credit Note Adjustment Amount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.creditAmount)}
                      </td>
                    </tr>
                    <tr style="font-weight: bold">
                      <td>Net Amount</td>
                      <td style="text-align: center">:</td>
                      <td style="text-align: right">
                        ${formatCurrency(bill?.netAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Bank Details -->
      <div class="bank-details">
        <table
          style="
            width: 100%;
            border-collapse: collapse;
            border-top: 1px solid #000;
          "
        >
          <tbody>
            <tr>
              <!-- Left Side -->
              <td
                style="
                  width: 70%;
                  padding: 2px;
                  vertical-align: top;
                "
              >
                <table style="width: 100%">
                  <tbody>
                    <tr>
                      <td colspan="3" style="font-weight: bold">Bank Details</td>
                    </tr>
                        <td style="width: 30%; padding: 0px 5px">Bank Name</td>
                        <td>: ${bankData?.bankName || ""}</td>
                      </tr>
                      <tr>
                        <td style="padding: 0px 5px">Branch</td>
                        <td style="font-weight: bold">: ${bankData?.branchCode || ""}</td>
                      </tr>
                      <tr>
                        <td style="padding: 0px 5px">IFSC Code</td>
                        <td style="font-weight: bold">: ${bankData?.ifscCode || ""}</td>
                      </tr>
                      <tr>
                        <td style="padding: 0px 5px">Account Type</td>
                        <td style="font-weight: bold">: ${bankData?.accountType || ""}</td>
                      </tr>
                      <tr>
                        <td style="padding: 0px 5px">Account Number</td>
                        <td style="font-weight: bold">: ${bankData?.accountNumber || ""}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td
                  style="
                    width: 30%;
                    text-align: right;
                    vertical-align: top;
                    horizontal-align: right;
                    padding: 3px;
                  "
                >
                  <div
                    style="
                      border: 2px solid #000;
                      padding: 1px;
                      display: inline-block;
                    "
                  >
                    ${
                      upiQRCode
                        ? `<img src="${upiQRCode}" alt="UPI QR Code" style="width: 100px; height: 100px;" />`
                        : `<div style="width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #929292;">QR</div>`
                    }
                    <p
                      style="
                        margin: 3px 12px 0 0;
                        font-size: 8px;
                        font-weight: bold;
                      "
                    >
                      Scan to Pay via UPI
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
      </div>

      <!-- Declarations -->
      <div class="terms-conditions">
        <div style="padding: 2px 2px 5px 3px;border-top: 1px solid #000; border-bottom: 1px solid #000">
          <p style="margin: 2px 0 2px 1px; font-weight: bold">Declarations:</p>
          <p style="margin: 0">${termConditionsHTML}</p>
        </div>
      </div>

      <!-- Signature Section (never breaks across pages) -->
      <div class="signature-section">
        <table
          style="width: 100%; border-collapse: collapse; padding: 8px 0 5px 0"
        >
          <tbody>
            <tr>
              <td
                style="
                  width: 50%;
                  text-align: center;
                  vertical-align: top;
                  padding-top: 5px;
                "
              >
                <p style="margin: 0; font-weight: bold; font-size: 9px">
                  RECEIVED THE MATERIAL IN GOOD CONDITION
                </p>
                <p
                  style="
                    margin: 20px 0 0 0;
                    font-weight: bold;
                    padding-top: 3px;
                    font-size: 9px;
                  "
                >
                  RECEIVER'S SIGNATURE AND SEAL
                </p>
              </td>
              <td
                style="
                  width: 50%;
                  text-align: center;
                  vertical-align: top;
                  padding-top: 5px;
                "
              >
                <p style="margin: 0; font-weight: bold; font-size: 9px">
                  For ${distributor.name || "Company Name"}
                </p>
                <p
                  style="
                    margin: 20px 0 0 0;
                    font-weight: bold;
                    padding-top: 3px;
                    font-size: 9px;
                  "
                >
                  Authorized Signatory
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = generateBillHTML;
