const numberToWords = require("../../bill/util/numberToWords");

/**
 * Generates HTML for a purchase order using the provided PO object
 * @param {Object} purchaseOrder - The purchase order object containing all PO data
 * @param {Object} options - Additional options for layout
 * @returns {string} - HTML string for the purchase order
 */
function generatePOHTML(purchaseOrder, options = {}) {
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

  const getTotalQty = () => {
    return purchaseOrder.lineItems.reduce((total, item) => {
      return total + item.oderQty;
    }, 0);
  };

  const getRoundOffAmt = () => {
    const totalAmount =
      Number(purchaseOrder.taxableAmount) +
      Number(purchaseOrder.cgst) +
      Number(purchaseOrder.sgst) +
      Number(purchaseOrder.igst);
    const netAmount = Number(purchaseOrder.netAmount) || 0;
    // return like - 0.55 or + 0.55
    return (Number(netAmount) - totalAmount).toFixed(2);
  };

  // Get distributor details
  const distributor = purchaseOrder.distributorId || {};

  // Get supplier details
  const supplier = purchaseOrder.supplierId || {};

  // Get bank data
  const bankData = purchaseOrder.bankData || {};

  // Build the HTML content
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Purchase Order - ${purchaseOrder.purchaseOrderNo || ""}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.2;
            color: #000;
            background: white;
            padding: 10px;
        }
        
        .container {
            width: 100%;
            max-width: 210mm;
            margin: 0 auto;
            background: white;
        }
        
        .header-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            border-bottom: 1px solid #000;
            padding-bottom: 10px;
        }
        
        .quotation-title {
            font-size: 18px;
            font-weight: bold;
            color: #000;
            flex: 1;
        }
        
        .quotation-title h2 {
            font-size: 18px;
            margin-bottom: 8px;
        }
        
        .rupa-logo {
            text-align: right;
            flex-shrink: 0;
        }
        
        .rupa-logo img {
            max-height: 60px;
            width: auto;
            display: block;
            margin-left: auto;
        }
        
        .po-details-section {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            gap: 20px;
        }
        
        .po-left-section,
        .po-right-section {
            width: 48%;
        }
        
        .detail-row {
            display: flex;
            margin-bottom: 3px;
            font-size: 11px;
        }
        
        .detail-label {
            font-weight: bold;
            width: 120px;
            color: #000;
            flex-shrink: 0;
        }
        
        .detail-value {
            flex: 1;
            color: #000;
        }
        
        .party-details {
            margin-bottom: 15px;
        }
        
        .party-details h3 {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 8px;
            color: #000;
        }
        
        .material-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
            font-size: 10px;
        }
        
        .material-table th {
            background-color: #f0f0f0;
            border: 1px solid #000;
            padding: 5px 3px;
            text-align: center;
            font-weight: bold;
            font-size: 10px;
        }
        
        .material-table td {
            border: 1px solid #000;
            padding: 4px 3px;
            text-align: center;
            font-size: 10px;
            vertical-align: top;
        }
        
        .material-table .text-left {
            text-align: left;
        }
        
        .material-table .text-right {
            text-align: right;
        }
        
        .calculations-section {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            gap: 20px;
        }
        
        .unit-details {
            width: 30%;
        }
        
        .unit-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
        }
        
        .unit-table th, 
        .unit-table td {
            border: 1px solid #000;
            padding: 4px;
            text-align: center;
        }
        
        .unit-table th {
            background-color: #f0f0f0;
            font-weight: bold;
        }
        
        .totals-section {
            width: 40%;
        }
        
        .totals-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
        }
        
        .totals-table td {
            border: 1px solid #000;
            padding: 4px 8px;
        }
        
        .totals-table .label {
            font-weight: bold;
            background-color: #f0f0f0;
            text-align: left;
            width: 60%;
        }
        
        .totals-table .amount {
            text-align: right;
            width: 40%;
        }
        
        .bank-details-section {
            margin-top: 15px;
            margin-bottom: 15px;
        }
        
        .bank-details-title {
            font-weight: bold;
            margin-bottom: 5px;
            font-size: 11px;
        }
        
        .bank-details-content {
            display: flex;
            justify-content: space-between;
            gap: 20px;
        }
        
        .bank-left, 
        .bank-right {
            width: 48%;
        }
        
        .terms-section {
            margin-top: 15px;
            font-size: 10px;
        }
        
        .terms-title {
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .signature-section {
            margin-top: 30px;
            text-align: right;
        }
        
        .signature-box {
            display: inline-block;
            text-align: center;
            margin-left: 20px;
        }
        
        .signature-line {
            border-top: 1px solid #000;
            margin-top: 30px;
            padding-top: 5px;
            font-size: 10px;
        }
        
        @media print {
            body {
                font-size: 10px;
                padding: 5px;
            }
            
            .container {
                max-width: none;
                margin: 0;
            }
            
            .header-section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header Section -->
        <div class="header-section">
            <div class="quotation-title">
                <h2>Quotation</h2>
                <div class="detail-row">
                    <span class="detail-label">Party PO:</span>
                    <span class="detail-value">${
                      purchaseOrder.purchaseOrderNo || ""
                    }</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Quotation Date:</span>
                    <span class="detail-value">${formatDate(
                      purchaseOrder.createdAt
                    )}</span>
                </div>
            </div>
            <div class="rupa-logo">
                <img src="${options.logoBase64 || "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1775744543343.png?alt=media"}" alt="Company Logo" />
            </div>
        </div>
        
        <!-- PO Details Section -->
        <div class="po-details-section">
            <div class="po-left-section">
                <div class="detail-row">
                    <span class="detail-label">Quotation From:</span>
                    <span class="detail-value">${distributor?.name || ""}
                    (${distributor?.dbCode})  
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Contact:</span>
                    <span class="detail-value">${
                      distributor?.phone || ""
                    }</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Address:</span>
                    <span class="detail-value">${distributor?.address || ""}, ${
    distributor?.city || ""
  }</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">City:</span>
                    <span class="detail-value">${distributor?.city || ""}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">State:</span>
                    <span class="detail-value">${
                      distributor?.stateId?.name || ""
                    }</span>
                </div>
            </div>
            
            <div class="po-right-section">
                <div class="detail-row">
                    <span class="detail-label">Quotation To:</span>
                    <span class="detail-value">${supplier?.supplierName || ""}
                    (${supplier?.supplierCode || ""})  
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Contact:</span>
                    <span class="detail-value">${
                      supplier?.contactNo || ""
                    }</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Address:</span>
                    <span class="detail-value">${supplier?.address || ""}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">City:</span>
                    <span class="detail-value">${supplier?.city || ""}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">State:</span>
                    <span class="detail-value">${
                      supplier?.stateId?.name || ""
                    }</span>
                </div>
            </div>
        </div>
        
        <!-- Material Table -->
        <table class="material-table">
            <thead>
                <tr>
                    <th style="width: 4%;">S.NO</th>
                    <th style="width: 30%;">PRODUCT</th>
                    <th style="width: 8%;">HSN CODE</th>
                    <th style="width: 8%;">Plant CODE</th>
                    <th style="width: 6%;">UOM</th>
                    <th style="width: 6%;">UOM Qty</th>
                    <th style="width: 6%;">PCS Qty</th>
                    <th style="width: 8%;">PRICE</th>
                    <th style="width: 8%;">TAX</th>
                    <th style="width: 8%;">NET %</th>
                </tr>
            </thead>
            <tbody>
                ${
                  purchaseOrder.lineItems
                    ?.map(
                      (item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td class="text-left">${item?.product?.name || ""}
                    ${item?.product?.product_code || ""}
                    </td>
                    <td>${item?.product?.product_hsn_code || ""}</td>
                    <td>${item?.plant?.plantCode || ""}</td>
                    <td>${item?.lineItemUOM || ""}</td>
                    <td class="text-right">${item?.boxOrderQty || 0}</td>
                    <td class="text-right">${item?.oderQty || 0}</td>
                    <td class="text-right">${formatCurrency(
                      item?.price?.dlp_price || 0
                    )}</td>
                    <td class="text-right">${formatCurrency(
                      (item?.totalCGST || 0) +
                        (item?.totalSGST || 0) +
                        (item?.totalIGST || 0)
                    )}</td>
                    <td class="text-right">${formatCurrency(
                      item?.netAmt || 0
                    )}</td>
                </tr>
                `
                    )
                    .join("") || ""
                }
            </tbody>
        </table>
        
        <!-- Calculations Section -->
        <div class="calculations-section">
            <!-- Details -->
            <div class="totals-section">
                <table class="totals-table">
                    <tr>
                        <td class="label">Total Items</td>
                        <td class="amount">${
                          purchaseOrder?.totalLines || 0
                        }</td>
                    </tr>
                   <tr>
                        <td class="label">Total Qty (PCS)</td>
                        <td class="amount">${getTotalQty()}</td>
                    </tr>
                </table>
            </div>

            <!-- Totals Section -->
            <div class="totals-section">
                <table class="totals-table">
                    <tr>
                        <td class="label">Total Gross Amt:</td>
                        <td class="amount">${formatCurrency(
                          purchaseOrder.grossAmount || 0
                        )}</td>
                    </tr>
                    <tr>
                        <td class="label">Total Taxable Amt:</td>
                        <td class="amount">${formatCurrency(
                          purchaseOrder.taxableAmount || 0
                        )}</td>
                    </tr>                    
                    <tr>
                        <td class="label">Total GST Amt:</td>
                        <td class="amount">${formatCurrency(
                          (Number(purchaseOrder.cgst) || 0) +
                            (Number(purchaseOrder.sgst) || 0) +
                            (Number(purchaseOrder.igst) || 0)
                        )}</td>
                    </tr>
                    <tr>
                        <td class="label">Round off Amt:</td>
                        <td class="amount">${getRoundOffAmt()}</td>
                    </tr>
                    <tr>
                        <td class="label">Net Amt:</td>
                        <td class="amount">${formatCurrency(
                          purchaseOrder.netAmount || 0
                        )}</td>
                    </tr>
                </table>
            </div>
        </div>
        
        <!-- Bank Details Section -->
        ${
          bankData?.bank_name
            ? `
        <div class="bank-details-section">
            <div class="bank-details-title">Bank Details :</div>
            <div class="bank-details-content">
                <div class="bank-left">
                    <div class="detail-row">
                        <span class="detail-label">Account Name:</span>
                        <span class="detail-value">${
                          bankData?.account_holder_name || ""
                        }</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Bank A/C:</span>
                        <span class="detail-value">${
                          bankData?.account_number || ""
                        }</span>
                    </div>
                </div>
                <div class="bank-right">
                    <div class="detail-row">
                        <span class="detail-label">Bank IFSC:</span>
                        <span class="detail-value">${
                          bankData?.ifsc_code || ""
                        }</span>
                    </div>
                </div>
            </div>
        </div>
        `
            : ""
        }
        
        <!-- Terms and Conditions -->
        <div class="terms-section">
            <div style="margin-top: 10px;">
                <strong>Terms & Conditions :</strong> No claim is valid after 2 days of delivery. No return no exchange. This is system generated invoice and hence does not require signature.
            </div>
            <div style="margin-top: 8px;">
                <strong>Declaration :</strong> Certified that particulars given above are true and correct and the amount indicated above represents the price actually charged and there is no flow of additional consideration directly or indirectly from the buyer.
            </div>
            <div style="margin-top: 8px;">
                <strong>Remarks :</strong> ${purchaseOrder?.orderRemark || ""}
            </div>
        </div>
        
        <!-- Signature Section -->
        <div class="signature-section">
            <div class="signature-box">
                <div class="signature-line">
                    <strong>Authorized Signatory</strong>
                </div>
                <div class="terms-title">For ${supplier?.supplierName || ""}
                    (${supplier?.supplierCode || ""}) </div>
            </div>
        </div>
    </div>
</body>
</html>
  `;

  return htmlContent;
}

module.exports = generatePOHTML;
