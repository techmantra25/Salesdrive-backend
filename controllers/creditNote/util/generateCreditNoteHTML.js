const generateCreditNoteHTML = (creditNote) => {
  // Helper function to format date
  const formatDate = (date) => {
    if (!date) return "";
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Helper function to format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0);
  };

  const distributor = creditNote.distributorId;
  const outlet = creditNote.outletId;
  const bank = creditNote.bankData;

  // Determine if this is a "With Reference" or "Manual" credit note
  const isWithReference = creditNote.creditNoteType === "With Reference";

  // ✅ CALCULATE TOTALS FROM LINE ITEMS (100% accurate)
  const calculateTotals = () => {
    if (!creditNote.lineItems || creditNote.lineItems.length === 0) {
      return {
        grossAmount: 0,
        taxableAmount: 0,
        cgst: 0,
        sgst: 0,
        netAmount: 0,
      };
    }

    return creditNote.lineItems.reduce(
      (totals, item) => ({
        grossAmount: totals.grossAmount + (item.grossAmt || 0),
        taxableAmount: totals.taxableAmount + (item.taxableAmt || 0),
        cgst: totals.cgst + (item.totalCGST || 0),
        sgst: totals.sgst + (item.totalSGST || 0),
        netAmount: totals.netAmount + (item.netAmt || 0),
      }),
      { grossAmount: 0, taxableAmount: 0, cgst: 0, sgst: 0, netAmount: 0 },
    );
  };

  const calculatedTotals = calculateTotals();

  // Use calculated totals for "With Reference" or database value for "Manual"
  const displayAmount =
    isWithReference && creditNote.lineItems?.length > 0
      ? calculatedTotals.netAmount
      : creditNote.amount;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Credit Note - ${creditNote.creditNoteNo}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.4;
          color: #000;
          background: #fff;
        }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          border: 1px solid #000;
        }
        
        .header {
          text-align: center;
          border-bottom: 2px solid #000;
          padding-bottom: 10px;
          margin-bottom: 20px;
        }
        
        .header h1 {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        
        .header h2 {
          font-size: 18px;
          color: #d32f2f;
          margin-bottom: 10px;
        }
        
        .company-details {
          margin-bottom: 20px;
        }
        
        .company-details h3 {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        
        .company-details p {
          margin: 2px 0;
        }
        
        .info-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }
        
        .info-box {
          border: 1px solid #ddd;
          padding: 10px;
        }
        
        .info-box h4 {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 8px;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
        }
        
        .info-row {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
        }
        
        .info-label {
          font-weight: bold;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        
        table th {
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
          font-weight: bold;
        }
        
        table td {
          border: 1px solid #ddd;
          padding: 6px;
        }
        
        .text-right {
          text-align: right;
        }
        
        .text-center {
          text-align: center;
        }
        
        .totals-section {
          margin-left: auto;
          width: 300px;
          border: 1px solid #ddd;
          padding: 10px;
        }
        
        .totals-row {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
        }
        
        .totals-row.grand-total {
          font-weight: bold;
          font-size: 14px;
          border-top: 2px solid #000;
          padding-top: 5px;
          margin-top: 10px;
        }
        
        .terms-conditions {
          margin-top: 30px;
          border-top: 1px solid #ddd;
          padding-top: 15px;
        }
        
        .terms-conditions h4 {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        
        .terms-conditions ol {
          margin-left: 20px;
        }
        
        .terms-conditions li {
          margin: 5px 0;
        }
        
        .bank-details {
          margin-top: 20px;
          border: 1px solid #ddd;
          padding: 10px;
          background-color: #f9f9f9;
        }
        
        .bank-details h4 {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 8px;
        }
        
        .signature-section {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
        }
        
        .signature-box {
          text-align: center;
        }
        
        .signature-line {
          border-top: 1px solid #000;
          width: 200px;
          margin-top: 60px;
          padding-top: 5px;
        }
        
        .status-badge {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 4px;
          font-weight: bold;
          font-size: 11px;
        }
        
        .status-adjusted {
          background-color: #d4edda;
          color: #155724;
        }
        
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          
          .container {
            padding: 0;
          }
        }
        @media print {
            .container {
            border: 2px solid #000;
            padding: 12px;
            }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header -->
        <div class="header">
          <h1>${distributor?.name || "Company Name"}</h1>
          <h2>CREDIT NOTE</h2>
          <p>${distributor?.address1 || ""} ${distributor?.address2 || ""}</p>
          <p>${distributor?.city || ""} - ${distributor?.pincode || ""}</p>
          <p>Phone: ${distributor?.phone || ""} | Email: ${distributor?.email || ""}</p>
          <p>GSTIN: ${distributor?.gst_no || ""} | PAN: ${distributor?.pan_no || ""}</p>
        </div>

        <!-- Credit Note Info -->
        <div class="info-section">
          <div class="info-box">
            <h4>Credit Note Details</h4>
            <div class="info-row">
              <span class="info-label">Credit Note No:</span>
              <span>${creditNote.creditNoteNo}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Date:</span>
              <span>${formatDate(creditNote.creditNoteCreationDate)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Type:</span>
              <span>${creditNote.creditNoteType}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Status:</span>
              <span ${
                creditNote.creditNoteStatus === "Pending"
                  ? "status-pending"
                  : "status-adjusted"
              }">
                ${creditNote.creditNoteStatus}
              </span>
            </div>
            ${
              creditNote.billId
                ? `
            <div class="info-row">
              <span class="info-label">Reference Bill:</span>
              <span>${creditNote.billId?.billNo || ""}</span>
            </div>
            `
                : ""
            }
            ${
              creditNote.salesReturnId
                ? `
            <div class="info-row">
              <span class="info-label">Sales Return:</span>
              <span>${creditNote.salesReturnId?.salesReturnNo || ""}</span>
            </div>
            `
                : ""
            }
          </div>

          <div class="info-box">
            <h4>Customer Details</h4>
            <div class="info-row">
              <span class="info-label">Name:</span>
              <span>${outlet?.outletName || ""}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Code:</span>
              <span>${outlet?.outletCode || ""}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Address:</span>
              <span>${outlet?.address1 || ""}</span>
            </div>
            <div class="info-row">
              <span class="info-label">City:</span>
              <span>${outlet?.city || ""}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Mobile:</span>
              <span>${outlet?.mobile1 || ""}</span>
            </div>
            ${
              outlet?.gstin
                ? `
            <div class="info-row">
              <span class="info-label">GSTIN:</span>
              <span>${outlet.gstin}</span>
            </div>
            `
                : ""
            }
          </div>
        </div>

        ${
          creditNote.creditNoteRemark
            ? `
        <div style="margin-bottom: 20px; padding: 10px; background: #f5f5f5; border-left: 4px solid #d32f2f;">
          <strong>Remark:</strong> ${creditNote.creditNoteRemark}
        </div>
        `
            : ""
        }

        <!-- Line Items Table (for With Reference credit notes) -->
        ${
          isWithReference &&
          creditNote.lineItems &&
          creditNote.lineItems.length > 0
            ? `
        <table>
          <thead>
            <tr>
              <th class="text-center">Sr. No.</th>
              <th>Product Name</th>
              <th class="text-center">Qty</th>
              <th class="text-right">Rate</th>
              <th class="text-right">Gross Amt</th>
              <th class="text-right">Taxable Amt</th>
              <th class="text-right">CGST</th>
              <th class="text-right">SGST</th>
              <th class="text-right">Net Amt</th>
            </tr>
          </thead>
          <tbody>
            ${creditNote.lineItems
              .map(
                (item, index) => `
              <tr>
                <td class="text-center">${index + 1}</td>
                <td>${item.product?.name || ""}</td>
                <td class="text-center">${item.returnQty || 0}</td>
                <td class="text-right">₹${formatCurrency(item.price?.rlp_price || 0)}</td>
                <td class="text-right">₹${formatCurrency(item.grossAmt)}</td>
                <td class="text-right">₹${formatCurrency(item.taxableAmt)}</td>
                <td class="text-right">₹${formatCurrency(item.totalCGST)}</td>
                <td class="text-right">₹${formatCurrency(item.totalSGST)}</td>
                <td class="text-right">₹${formatCurrency(item.netAmt)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        `
            : ""
        }

        <!-- Totals Section (✅ NOW CALCULATED FROM LINE ITEMS) -->
        <div class="totals-section">
          ${
            isWithReference &&
            creditNote.lineItems &&
            creditNote.lineItems.length > 0
              ? `
          <div class="totals-row">
            <span>Gross Amount:</span>
            <span>₹${formatCurrency(calculatedTotals.grossAmount)}</span>
          </div>
          <div class="totals-row">
            <span>Taxable Amount:</span>
            <span>₹${formatCurrency(calculatedTotals.taxableAmount)}</span>
          </div>
          <div class="totals-row">
            <span>CGST:</span>
            <span>₹${formatCurrency(calculatedTotals.cgst)}</span>
          </div>
          <div class="totals-row">
            <span>SGST:</span>
            <span>₹${formatCurrency(calculatedTotals.sgst)}</span>
          </div>
          `
              : ""
          }
          <div class="totals-row grand-total">
            <span>Credit Note Amount:</span>
            <span>₹${formatCurrency(displayAmount)}</span>
          </div>
        </div>

        <!-- Adjusted Bills Section -->
        ${
          creditNote.adjustedBillIds && creditNote.adjustedBillIds.length > 0
            ? `
        <div style="margin-top: 30px;">
          <h4 style="font-size: 14px; font-weight: bold; margin-bottom: 10px;">Adjusted Against Bills:</h4>
          <table>
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Bill No.</th>
                <th>Type</th>
                <th class="text-right">Adjusted Amount</th>
              </tr>
            </thead>
            <tbody>
              ${creditNote.adjustedBillIds
                .map(
                  (adj, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${adj.billId?.billNo || ""}</td>
                  <td>${adj.type || ""}</td>
                  <td class="text-right">₹${formatCurrency(adj.adjustedAmount)}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        `
            : ""
        }

        <!-- Bank Details -->
        ${
          bank
            ? `
        <div class="bank-details">
          <h4>Bank Details for Payment</h4>
          <div class="info-row">
            <span class="info-label">Bank Name:</span>
            <span>${bank.bankName || ""}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Account No:</span>
            <span>${bank.accountNumber || ""}</span>
          </div>
          <div class="info-row">
            <span class="info-label">IFSC Code:</span>
            <span>${bank.ifscCode || ""}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Branch:</span>
            <span>${bank.branchName || ""}</span>
          </div>
        </div>
        `
            : ""
        }

        <!-- Terms and Conditions -->
        ${
          creditNote.termConditions && creditNote.termConditions.length > 0
            ? `
        <div class="terms-conditions">
          <h4>Terms & Conditions:</h4>
          <ol>
            ${creditNote.termConditions.map((term) => `<li>${term}</li>`).join("")}
          </ol>
        </div>
        `
            : ""
        }

        <!-- Signature Section -->
        <div class="signature-section">
          <div class="signature-box">
            <div class="signature-line">Customer Signature</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">Authorized Signatory</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = generateCreditNoteHTML;
