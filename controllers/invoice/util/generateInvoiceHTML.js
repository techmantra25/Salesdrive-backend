const numberToWords = require("./numberToWords");

/**
 * Generates HTML for an invoice using the provided invoice object
 * @param {Object} invoice - The invoice object containing all invoice data
 * @param {Object} options - Additional options for layout
 * @returns {string} - HTML string for the invoice
 */
function generateInvoiceHTML(invoice, options = {}) {
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
  const distributor = invoice.distributorId || {};

  // Filter valid line items
  const validLineItems = invoice.lineItems || [];

  // Generate line items HTML
  let lineItemsHTML = "";
  validLineItems.forEach((item, index) => {
    const product = item.product || {};
    const plant = item.plant || {};

    lineItemsHTML += `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${
          index + 1
        }</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: left;">${
          product.name || ""
        } ${product.product_code || ""}</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${
          product.product_hsn_code || ""
        }</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${
          plant.name || ""
        }</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${
          item.qty || 0
        }</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${
          item.receivedQty || 0
        }</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: center;">${getBoxQty(
          item,
          item.qty
        )}</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">${formatCurrency(
          item.mrp || 0
        )}</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">${formatCurrency(
          item.grossAmount || 0
        )}</td>
        <td style="border-right: 1px solid #000; padding: 2px; text-align: right;">${formatCurrency(
          (item.discountAmount || 0) + (item.specialDiscountAmount || 0)
        )}</td>
        <td style="padding: 2px; text-align: right;">${formatCurrency(
          item.netAmount || 0
        )}</td>
      </tr>
    `;
  });

  const emptyRowsCount = Math.max(0, 36 - validLineItems.length);
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
    try {
      const amount = Math.floor(invoice.totalInvoiceAmount || 0);
      if (amount === 0) return "Zero Rupees Only";
      return numberToWords(amount) + " Rupees Only";
    } catch (error) {
      return "Amount in words calculation error";
    }
  };

  // Generate the HTML
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>
      ${invoice.invoiceNo ? `Invoice_${invoice.invoiceNo}` : "Invoice"}
    </title>
    <style>
      @page {
        size: A4;
        margin: 8mm 5mm 8mm 5mm;
      }
      * {
        box-sizing: border-box;
      }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        font-size: 10px;
        line-height: 1.2;
        color: #000;
      }
      .invoice-container {
        border: 1px solid #000;
        max-width: 900px;
        margin: 0 auto;
        background: white;
      }
      .header-section {
        position: relative;
        text-align: center;
        padding: 10px 0 5px 0;
        border-bottom: 1px solid #000;
      }
      .logo-container {
        position: absolute;
        top: -7px;
        right: 10px;
        width: 100px;
      }
      .logo-container img {
        width: 100%;
        max-height: 80px;
        object-fit: contain;
      }
      .invoice-title {
        text-align: center;
        padding: 5px 0;
        border-bottom: 1px solid #000;
      }
      .invoice-details {}
      .items-section {}
      .items-table {
        width: 100%;
        border-collapse: collapse;
      }
      .items-table thead {
        display: table-header-group;
      }
      .items-table tbody tr.page-break-before {
        page-break-before: always;
      }
      .summary-section {}
      .signature-section {
        /* Only this section will never break across pages */
        break-inside: avoid;
        page-break-inside: avoid;
        break-before: avoid;
        page-break-before: avoid;
        break-after: avoid;
        page-break-after: avoid;
      }
      table {
        page-break-inside: auto;
      }
      tr {
        page-break-inside: auto;
        page-break-after: auto;
      }
      th, td {
        page-break-inside: auto;
      }
      h2, h3 {
        margin: 0;
      }
      p {
        margin: 5px 0;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .invoice-container {
          border: 1px solid #000 !important;
        }
        table, th, td {
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
              src="https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1775744543343.png?alt=media"
              alt="Company Logo"
              onerror="this.style.display='none'"
            />
          </div>
          <h2 style="margin: 0; font-size: 18px">
            ${distributor.name || "Company Name"}
          </h2>
          <p style="margin: 5px 0">
            ${distributor.address1 || ""}, ${distributor.address2 || ""}
          </p>
          <table style="width: 100%; margin-top: 5px">
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
                <td style="text-align: left">: ${
                  distributor?.stateId?.name || ""
                }${
    distributor?.stateId?.slug && distributor?.stateId?.code
      ? ` (${distributor?.stateId?.slug}) (${distributor?.stateId?.code})`
      : ""
  }</td>
                <td style="text-align: left">
                  <strong>Phone No.</strong>
                </td>
                <td style="text-align: left">: ${distributor.phone || ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Invoice Title -->
        <div class="invoice-title">
          <h3 style="margin: 0; font-size: 16px">TAX INVOICE</h3>
        </div>

        <!-- Invoice Details -->
        <div class="invoice-details">
          <table style="width: 100%; border-collapse: collapse; border-bottom: 1px solid #000;">
            <tbody>
              <tr>
                <td style="width: 50%; padding: 2px; border-right: 1px solid #000; vertical-align: top;">
                  <table style="width: 100%">
                    <tbody>
                      <tr>
                        <td colspan="2" style="font-weight: bold">
                          Invoice Details
                        </td>
                      </tr>
                      <tr>
                        <td>Invoice No.</td>
                        <td>: ${invoice.invoiceNo || ""}</td>
                      </tr>
                      <tr>
                        <td>Invoice Date</td>
                        <td>: ${formatDate(invoice.date)}</td>
                      </tr>
                      <tr>
                        <td>GRN No.</td>
                        <td>: ${invoice.grnNumber || ""}</td>
                      </tr>
                      <tr>
                        <td>GRN Date</td>
                        <td>: ${formatDate(invoice.grnDate)}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style="width: 50%; padding: 2px; vertical-align: top;">
                  <table style="width: 100%">
                    <tbody>
                      <tr>
                        <td colspan="2" style="font-weight: bold">
                          Shipping Details
                        </td>
                      </tr>
                      <tr>
                        <td>Transporter Name</td>
                        <td>: ${invoice?.shipping?.transporterName || ""}</td>
                      </tr>
                      <tr>
                        <td>LR No.</td>
                        <td>: ${invoice?.shipping?.lrNo || ""}</td>
                      </tr>
                      <tr>
                        <td>IRN No.</td>
                        <td>: ${invoice?.shipping?.irnNo || ""}</td>
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
          <table class="items-table" style="border-bottom: 1px solid #000;">
            <thead>
              <tr style="border-bottom: 1px solid #000">
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Sr.No.</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: left;">Item Description</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">HSN/SAC</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Plant</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Qty In<br />PCS</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Received<br />Qty</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Box<br />Qty</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">MRP<br />Rate</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Gross<br />Amount</th>
                <th style="border-right: 1px solid #000; padding: 2px; text-align: center;">Discount<br />Amount</th>
                <th style="padding: 2px; text-align: center">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemsHTML}
            </tbody>
          </table>
        </div>

        <!-- Summary Section -->
        <div class="summary-section">
          <table style="width: 100%; border-collapse: collapse; border-bottom: 1px solid #000;">
            <tbody>
              <tr>
                <!-- Left Side -->
                <td style="width: 50%; padding: 2px; border-right: 1px solid #000; vertical-align: top;">
                  <table style="width: 100%">
                    <tbody>
                      <tr>
                        <td colspan="3" style="font-weight: bold">E & O.E</td>
                      </tr>
                      <tr>
                        <td colspan="2">Number of Items</td>
                        <td>: ${validLineItems.length || 0}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Total Qty In PCS</td>
                        <td>: ${validLineItems.reduce(
                          (sum, item) => sum + (item.qty || 0),
                          0
                        )}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Total Received Qty</td>
                        <td>: ${validLineItems.reduce(
                          (sum, item) => sum + (item.receivedQty || 0),
                          0
                        )}</td>
                      </tr>
                      <tr>
                        <td colspan="3" style="padding-top: 10px">Amount In Words :</td>
                      </tr>
                      <tr>
                        <td colspan="3" style="font-weight: bold">
                          ${amountInWords()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <!-- Right Side -->
                <td style="width: 50%; padding: 2px; vertical-align: top;">
                  <table style="width: 100%">
                    <tbody>
                      <tr>
                        <td style="width: 60%">Gross Amount :</td>
                        <td style="width: 10%; text-align: center">:</td>
                        <td style="width: 30%; text-align: right">${formatCurrency(
                          invoice.grossAmount
                        )}</td>
                      </tr>
                      <tr>
                        <td>Trade Discount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.tradeDiscount
                        )}</td>
                      </tr>
                      <tr>
                        <td>Special Discount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.specialDiscountAmount
                        )}</td>
                      </tr>
                      <tr>
                        <td>Taxable Amount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.taxableAmount
                        )}</td>
                      </tr>
                      <tr>
                        <td>CGST</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.cgst
                        )}</td>
                      </tr>
                      <tr>
                        <td>SGST</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.sgst
                        )}</td>
                      </tr>
                      <tr>
                        <td>IGST</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.igst
                        )}</td>
                      </tr>
                      <tr>
                        <td>Invoice Amount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.invoiceAmount
                        )}</td>
                      </tr>
                      <tr>
                        <td>Round Off Amount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.roundOff
                        )}</td>
                      </tr>
                      <tr style="font-weight: bold">
                        <td>Net Amount</td>
                        <td style="text-align: center">:</td>
                        <td style="text-align: right">${formatCurrency(
                          invoice.totalInvoiceAmount
                        )}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Signature Section (never breaks across pages) -->
        <div class="signature-section">
          <table style="width: 100%; border-collapse: collapse; padding: 10px 0;">
            <tbody>
              <tr>
                <td style="width: 50%; text-align: center; vertical-align: top;">
                  <p style="margin: 0; font-weight: bold">
                    RECEIVED THE MATERIAL IN GOOD CONDITION
                  </p>
                  <p style="margin: 40px 0 0 0; font-weight: bold">
                    RECEIVER'S SIGNATURE AND SEAL
                  </p>
                </td>
                <td style="width: 50%; text-align: center; vertical-align: top;">
                  <p style="margin: 0; font-weight: bold">
                    For ${distributor.name || "Company Name"}
                  </p>
                  <p style="margin: 40px 0 0 0; font-weight: bold">
                    Authorized Signatory
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = generateInvoiceHTML;
