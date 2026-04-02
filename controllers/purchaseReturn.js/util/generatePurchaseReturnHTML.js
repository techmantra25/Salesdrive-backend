const numberToWords = require("../../invoice/util/numberToWords");

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
    (Number(item?.cgst) || 0) +
    (Number(item?.sgst) || 0) +
    (Number(item?.igst) || 0)
  );
};

const getReturnQty = (item) => {
  return Number(item?.qty ?? item?.returnedQty ?? 0) || 0;
};

const getGoodsTypeLabel = (goodsType) => {
  if (goodsType === "free") return "FREE";
  return "BILLED";
};

const formatAmountInWords = (amount) => {
  const roundedAmount = Math.round(Number(amount) || 0);

  if (!roundedAmount) {
    return "Zero Rupees Only";
  }

  return `${numberToWords(roundedAmount)} Rupees Only`;
};

const idsMatch = (left, right) => {
  if (!left || !right) return false;
  return String(left) === String(right);
};

const findInvoiceLineItem = (invoiceLineItems, purchaseReturnItem) => {
  const productId = purchaseReturnItem?.product?._id || purchaseReturnItem?.product;
  const plantId = purchaseReturnItem?.plant?._id || purchaseReturnItem?.plant;
  const poNumber = purchaseReturnItem?.poNumber;

  return (
    invoiceLineItems.find((invoiceItem) => {
      const invoiceProductId = invoiceItem?.product?._id || invoiceItem?.product;
      const invoicePlantId = invoiceItem?.plant?._id || invoiceItem?.plant;

      return (
        idsMatch(invoiceProductId, productId) &&
        idsMatch(invoicePlantId, plantId) &&
        (!poNumber || invoiceItem?.poNumber === poNumber)
      );
    }) ||
    invoiceLineItems.find((invoiceItem) => {
      const invoiceProductId = invoiceItem?.product?._id || invoiceItem?.product;
      return idsMatch(invoiceProductId, productId);
    }) ||
    {}
  );
};

const getUniqueSuppliers = (lineItems) => {
  const supplierMap = new Map();

  for (const item of lineItems) {
    const supplier = item?.product?.supplier;
    const supplierId = supplier?._id ? String(supplier._id) : null;

    if (supplierId && !supplierMap.has(supplierId)) {
      supplierMap.set(supplierId, supplier);
    }
  }

  return Array.from(supplierMap.values());
};

const generatePurchaseReturnHTML = (purchaseReturn, options = {}) => {
  const distributor = purchaseReturn?.distributorId || {};
  const invoice = purchaseReturn?.invoiceId || {};
  const validLineItems = (purchaseReturn?.lineItems || []).filter(
    (item) => getReturnQty(item) > 0,
  );
  const invoiceLineItems = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  const suppliers = getUniqueSuppliers(validLineItems);
  const primarySupplier = suppliers[0] || {};
  const hasMultipleSuppliers = suppliers.length > 1;
  const supplierSummary = hasMultipleSuppliers
    ? `Multiple Suppliers (${suppliers.length})`
    : `${primarySupplier?.supplierName || ""}${
        primarySupplier?.supplierCode ? ` (${primarySupplier.supplierCode})` : ""
      }`;
  const termConditions = purchaseReturn?.termConditions || [];

  const billedItemsCount = validLineItems.filter(
    (item) => item?.goodsType === "billed",
  ).length;
  const freeItemsCount = validLineItems.filter(
    (item) => item?.goodsType === "free",
  ).length;
  const totalReturnQty = validLineItems.reduce(
    (sum, item) => sum + getReturnQty(item),
    0,
  );

  const emptyRows = Array.from({
    length: Math.max(0, 15 - validLineItems.length),
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Purchase Return - ${escapeHtml(purchaseReturn?.code || "")}</title>
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
            font-size: 10px;
            line-height: 1.35;
            color: #000;
            background: #fff;
            margin: 0;
          }
          .container {
            border: 1px solid #000;
            max-width: 900px;
            margin: 0 auto;
            background: #fff;
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
          .header h2,
          .document-title h3 {
            margin: 0;
          }
          .header p {
            margin: 5px 0;
          }
          .header-table,
          .details-section,
          .summary-section,
          .signature-section {
            width: 100%;
            border-collapse: collapse;
          }
          .header-table td,
          .details-section td,
          .summary-section td,
          .signature-section td {
            padding: 2px;
            vertical-align: top;
          }
          .document-title {
            text-align: center;
            padding: 5px 0;
            border-bottom: 1px solid #000;
            background-color: #eef7ff;
          }
          .document-title h3 {
            font-size: 16px;
            color: #0d47a1;
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
          .highlight-box {
            background-color: #fff9e6;
            border-left: 4px solid #ff9800;
            padding: 8px;
            margin: 5px 0;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            border-bottom: 1px solid #000;
            table-layout: fixed;
          }
          .items-table th {
            border-right: 1px solid #000;
            border-bottom: 1px solid #000;
            padding: 5px 2px;
            text-align: center;
            white-space: pre-line;
            background-color: #f5f5f5;
            font-size: 9px;
            font-weight: bold;
            vertical-align: middle;
            word-break: break-word;
          }
          .items-table th:last-child,
          .items-table td:last-child {
            border-right: none;
          }
          .items-table td {
            border-right: 1px solid #000;
            border-bottom: 1px solid #eee;
            padding: 3px 2px;
            font-size: 9px;
            text-align: center;
            vertical-align: middle;
            word-break: break-word;
          }
          .items-table tbody tr:last-child td {
            border-bottom: 2px solid #000;
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
          .goods-badge {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 8px;
            font-weight: bold;
          }
          .goods-billed {
            color: #000;
          }
          .goods-free {
            color: #000;
          }
          .terms-section {
            padding: 5px;
            border-bottom: 1px solid #000;
          }
          .terms-section ol {
            margin: 5px 0 5px 25px;
            padding: 0;
          }
          .signature-section td {
            width: 50%;
            text-align: center;
            padding: 10px;
          }
          .signature-line {
            border-top: 1px solid #000;
            width: 200px;
            margin: 60px auto 0 auto;
            padding-top: 5px;
          }
          .border-top-bold {
            border-top: 2px solid #000;
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
        <div class="container">
          <div class="header">
            <div class="logo">
              <img
                src="${escapeHtml(options?.logoBase64 || options?.logoUrl || "")}"
                alt="Company Logo"
                onerror="this.style.display='none'"
              />
            </div>

            <h2>${escapeHtml(distributor?.name || "Company Name")}</h2>
            <p>${escapeHtml(
              `${distributor?.address1 || ""}${
                distributor?.address2 ? `, ${distributor.address2}` : ""
              }`,
            )}</p>

            <table class="header-table">
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
                    : ${escapeHtml(distributor?.stateId?.name || "")}${
                      distributor?.stateId?.slug && distributor?.stateId?.code
                        ? ` (${escapeHtml(distributor.stateId.slug)}) (${escapeHtml(
                            distributor.stateId.code,
                          )})`
                        : ""
                    }
                  </td>
                  <td style="text-align: left;">
                    <strong>Phone No.</strong>
                  </td>
                  <td style="text-align: left;">
                    : <strong>${escapeHtml(distributor?.phone || "")}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="document-title">
            <h3>PURCHASE RETURN</h3>
          </div>

          <table class="details-section" style="border-bottom: 1px solid #000;">
            <tbody>
              <tr>
                <td class="left-section">
                  <table style="width: 100%;">
                    <tbody>
                      <tr>
                        <td colspan="2" class="bold">Supplier Details</td>
                      </tr>
                      <tr>
                        <td style="width: 30%;">Supplier</td>
                        <td>: ${escapeHtml(supplierSummary)}</td>
                      </tr>
                      <tr>
                        <td>Address</td>
                        <td>: ${escapeHtml(primarySupplier?.address || "")}</td>
                      </tr>
                      <tr>
                        <td>City</td>
                        <td>: ${escapeHtml(primarySupplier?.city || "")}</td>
                      </tr>
                      <tr>
                        <td>State</td>
                        <td>: ${escapeHtml(primarySupplier?.stateId?.name || "")}</td>
                      </tr>
                      <tr>
                        <td>Phone No.</td>
                        <td>: ${escapeHtml(primarySupplier?.contactNo || "")}</td>
                      </tr>
                      <tr>
                        <td>GSTIN No.</td>
                        <td>: ${escapeHtml(primarySupplier?.gstNo || "")}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td class="right-section">
                  <table style="width: 100%;">
                    <tbody>
                      <tr>
                        <td colspan="2" class="bold">Purchase Return Details</td>
                      </tr>
                      <tr>
                        <td style="width: 34%;"><strong>Purchase Return No.</strong></td>
                        <td>: <strong>${escapeHtml(purchaseReturn?.code || "")}</strong></td>
                      </tr>
                      <tr>
                        <td>Return Date</td>
                        <td>: ${escapeHtml(formatDate(purchaseReturn?.createdAt))}</td>
                      </tr>
                      <tr>
                        <td>Status</td>
                        <td>: ${escapeHtml(purchaseReturn?.status || "")}</td>
                      </tr>
                      <tr>
                        <td><strong>Reference Invoice No.</strong></td>
                        <td>: <strong>${escapeHtml(invoice?.invoiceNo || "")}</strong></td>
                      </tr>
                      <tr>
                        <td>Invoice Date</td>
                        <td>: ${escapeHtml(formatDate(invoice?.date))}</td>
                      </tr>
                      <tr>
                        <td><strong>GRN No.</strong></td>
                        <td>: <strong>${escapeHtml(invoice?.grnNumber || "")}</strong></td>
                      </tr>
                      <tr>
                        <td>GRN Date</td>
                        <td>: ${escapeHtml(formatDate(invoice?.grnDate))}</td>
                      </tr>
                      <tr>
                        <td>Transporter</td>
                        <td>: ${escapeHtml(
                          invoice?.shipping?.transporterName || "",
                        )}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          ${
            purchaseReturn?.remarks
              ? `
          <div class="highlight-box">
            <strong>Remarks:</strong> ${escapeHtml(purchaseReturn.remarks)}
          </div>
          `
              : ""
          }

          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 4%;">Sr.<br/>No.</th>
                <th style="width: 22%;">Item Description</th>
                <th style="width: 5%;">HSN</th>
                <th style="width: 6%;">Plant</th>
                <th style="width: 6%;">Goods<br/>Type</th>
                <th style="width: 7%;">Received<br/>Qty</th>
                <th style="width: 7%;">Return<br/>Qty</th>
                <th style="width: 6%;">Box<br/>Qty</th>
                <th style="width: 7%;">MRP<br/>Rate</th>
                <th style="width: 7%;">Discount</th>
                <th style="width: 7%;">Taxable</th>
                <th style="width: 7%;">Tax</th>
                <th style="width: 9%;">Net<br/>Amt</th>
              </tr>
            </thead>
            <tbody>
              ${validLineItems
                .map((item, index) => {
                  const product = item?.product || {};
                  const plant = item?.plant || {};
                  const invoiceLineItem = findInvoiceLineItem(invoiceLineItems, item);
                  const receivedQty =
                    Number(invoiceLineItem?.receivedQty ?? invoiceLineItem?.qty ?? 0) || 0;
                  const returnQty = getReturnQty(item);
                  const goodsTypeClass =
                    item?.goodsType === "free" ? "goods-free" : "goods-billed";

                  return `
                    <tr>
                      <td class="text-center">${index + 1}</td>
                      <td class="text-center">${escapeHtml(
                        `${product?.name || ""}${
                          product?.product_code ? ` (${product.product_code})` : ""
                        }`,
                      )}</td>
                      <td class="text-center">${escapeHtml(
                        product?.product_hsn_code || "",
                      )}</td>
                      <td class="text-center">${escapeHtml(plant?.name || "")}</td>
                      <td class="text-center">
                        <span class="goods-badge ${goodsTypeClass}">${escapeHtml(
                          getGoodsTypeLabel(item?.goodsType),
                        )}</span>
                      </td>
                      <td class="text-center">${receivedQty}</td>
                      <td class="text-center">${returnQty}</td>
                      <td class="text-center">${getBoxQty(product, returnQty)}</td>
                      <td class="text-center">Rs. ${formatCurrency(item?.mrp)}</td>
                      <td class="text-center">Rs. ${formatCurrency(
                        (Number(item?.discountAmount) || 0) +
                          (Number(item?.specialDiscountAmount) || 0),
                      )}</td>
                      <td class="text-center">Rs. ${formatCurrency(
                        item?.taxableAmount,
                      )}</td>
                      <td class="text-center">Rs. ${formatCurrency(
                        getTaxAmount(item),
                      )}</td>
                      <td class="text-center">Rs. ${formatCurrency(item?.netAmount)}</td>
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
                      <td></td>
                      <td></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>

          <table class="summary-section" style="border-bottom: 1px solid #000;">
            <tbody>
              <tr>
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
                        <td>: ${totalReturnQty}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Billed Items</td>
                        <td>: ${billedItemsCount}</td>
                      </tr>
                      <tr>
                        <td colspan="2">Free Items</td>
                        <td>: ${freeItemsCount}</td>
                      </tr>
                      ${
                        purchaseReturn?.totalBasePoints
                          ? `
                      <tr>
                        <td colspan="2">Base Points Deducted</td>
                        <td>: ${escapeHtml(purchaseReturn.totalBasePoints)}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td colspan="3" style="padding-top: 8px;">
                          <strong>Amount In Words:</strong>
                          ${escapeHtml(
                            formatAmountInWords(purchaseReturn?.totalInvoiceAmount),
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td class="right-section">
                  <table style="width: 100%;">
                    <tbody>
                      <tr>
                        <td style="width: 60%;">Gross Amount</td>
                        <td style="width: 10%;" class="text-center">:</td>
                        <td style="width: 30%;" class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.grossAmount,
                        )}</td>
                      </tr>
                      <tr>
                        <td>Trade Discount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.tradeDiscount,
                        )}</td>
                      </tr>
                      <tr>
                        <td>Special Discount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.specialDiscountAmount,
                        )}</td>
                      </tr>
                      <tr>
                        <td>Taxable Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.taxableAmount,
                        )}</td>
                      </tr>
                      <tr>
                        <td>CGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.cgst,
                        )}</td>
                      </tr>
                      <tr>
                        <td>SGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.sgst,
                        )}</td>
                      </tr>
                      ${
                        Number(purchaseReturn?.igst) > 0
                          ? `
                      <tr>
                        <td>IGST</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.igst,
                        )}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td>Invoice Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.invoiceAmount,
                        )}</td>
                      </tr>
                      ${
                        Number(purchaseReturn?.roundOff) !== 0
                          ? `
                      <tr>
                        <td>Round Off Amount</td>
                        <td class="text-center">:</td>
                        <td class="text-right">Rs. ${formatCurrency(
                          purchaseReturn?.roundOff,
                        )}</td>
                      </tr>
                      `
                          : ""
                      }
                      <tr class="bold border-top-bold">
                        <td style="padding-top: 5px;">Net Amount</td>
                        <td class="text-center" style="padding-top: 5px;">:</td>
                        <td class="text-right" style="padding-top: 5px;">Rs. ${formatCurrency(
                          purchaseReturn?.totalInvoiceAmount,
                        )}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

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
              : ""
          }

          <table class="signature-section">
            <tbody>
              <tr>
                <td>
                  <p class="bold">RECEIVER'S SIGNATURE AND SEAL</p>
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

module.exports = generatePurchaseReturnHTML;
