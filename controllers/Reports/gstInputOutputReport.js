const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Distributor = require("../../models/distributor.model");
const Invoice = require("../../models/invoice.model");
const Bill = require("../../models/bill.model");
const SalesReturn = require("../../models/salesReturn.model");
const PurchaseReturn = require("../../models/purchaseReturn.model");
const Product = require("../../models/product.model");

const gstInputOutputReport = asyncHandler(async (req, res) => {
  try {
    const { distributorId, startDate, endDate } = req.query;

    if (!distributorId || !startDate || !endDate) {
      res.status(400);
      throw new Error(
        "Missing required fields: distributorId, startDate, endDate"
      );
    }

    const startOfDay = moment
      .tz(startDate, "Asia/Kolkata")
      .startOf("day")
      .toDate();
    const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();

    if (startOfDay > endOfDay) {
      res.status(400);
      throw new Error("Start date cannot be after end date");
    }

    // Find distributor with minimal fields
    const distributor = await Distributor.findById(distributorId).select(
      "name dbCode gst_no"
    );

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const fileName = `Gst-Input-Output-Report-${distributor.dbCode}-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const headers = [
      "Date",
      "GST Type",
      "GST For",
      "Document Number",
      "Product Code",
      "HSN Code",
      "GST Rate",
      "Taxable Value",
      "CGST Amount",
      "SGST Amount",
      "IGST Amount",
      "Total GST",
      "Net Amount",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Track totals for summary
    let totalGstInput = 0;
    let totalGstOutput = 0;

    // Helper function to calculate GST rate
    const getGstRate = (product) => {
      if (!product) return "";

      if (product.igst && parseFloat(product.igst) > 0) {
        return `${product.igst}%`;
      } else if (product.cgst && product.sgst) {
        const cgstRate = parseFloat(product.cgst) || 0;
        const sgstRate = parseFloat(product.sgst) || 0;
        const totalRate = cgstRate + sgstRate;
        return totalRate > 0 ? `${totalRate}%` : "";
      }
      return "";
    };

    // Helper function to write line item transaction
    const writeLineItemTransaction = (baseTransaction, lineItem, product) => {
      const totalGst =
        (lineItem.igst || lineItem.totalIGST) > 0
          ? lineItem.igst || lineItem.totalIGST
          : (lineItem.cgst || lineItem.totalCGST) +
            (lineItem.sgst || lineItem.totalSGST);

      const transaction = {
        ...baseTransaction,
        productCode: product?.product_code || "",
        hsnCode: product?.product_hsn_code || "",
        gstRate: getGstRate(product),
        taxableValue: lineItem.taxableAmount || lineItem.taxableAmt || 0,
        cgstAmount: lineItem.cgst || lineItem.totalCGST || 0,
        sgstAmount: lineItem.sgst || lineItem.totalSGST || 0,
        igstAmount: lineItem.igst || lineItem.totalIGST || 0,
        totalGst: totalGst,
        netAmount: lineItem.netAmount || lineItem.netAmt || 0,
      };

      csvStream.write({
        Date: moment.tz(transaction.date, "Asia/Kolkata").format("DD-MM-YYYY"),
        "GST Type": transaction.gstType,
        "GST For": transaction.gstFor,
        "Document Number": transaction.documentNumber,
        "Product Code": transaction.productCode,
        "HSN Code": transaction.hsnCode,
        "GST Rate": transaction.gstRate,
        "Taxable Value": parseFloat(transaction.taxableValue || 0).toFixed(2),
        "CGST Amount": parseFloat(transaction.cgstAmount || 0).toFixed(2),
        "SGST Amount": parseFloat(transaction.sgstAmount || 0).toFixed(2),
        "IGST Amount": parseFloat(transaction.igstAmount || 0).toFixed(2),
        "Total GST": parseFloat(transaction.totalGst || 0).toFixed(2),
        "Net Amount": parseFloat(transaction.netAmount || 0).toFixed(2),
      });

      // Update totals
      if (transaction.gstType === "GST INPUT") {
        totalGstInput += transaction.totalGst || 0;
      } else {
        totalGstOutput += transaction.totalGst || 0;
      }
    };

    // Cache for products to avoid repeated queries
    const productCache = new Map();

    const getProduct = async (productId) => {
      if (!productId) return null;

      if (productCache.has(productId.toString())) {
        return productCache.get(productId.toString());
      }

      const product = await Product.findById(productId).select(
        "product_code product_hsn_code cgst sgst igst"
      );

      productCache.set(productId.toString(), product);
      return product;
    };

    // 1. Process GST INPUT from confirmed GRNs using cursor for memory efficiency
    const invoiceCursor = Invoice.find({
      distributorId: distributorId,
      status: "Confirmed",
      grnDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("grnDate grnNumber invoiceNo lineItems")
      .sort({ grnDate: 1 })
      .cursor();

    for (
      let invoice = await invoiceCursor.next();
      invoice != null;
      invoice = await invoiceCursor.next()
    ) {
      const baseTransaction = {
        date: invoice.grnDate,
        gstType: "GST INPUT",
        gstFor: "GRN",
        documentNumber: invoice.grnNumber || invoice.invoiceNo,
      };

      // Process each line item
      for (const lineItem of invoice.lineItems) {
        const product = await getProduct(lineItem.product);
        writeLineItemTransaction(baseTransaction, lineItem, product);
      }
    }

    // 2. Process GST OUTPUT from delivered bills using cursor
    const billCursor = Bill.find({
      distributorId: distributorId,
      status: "Delivered",
      "dates.deliveryDate": { $gte: startOfDay, $lte: endOfDay },
    })
      .select("dates.deliveryDate billNo lineItems")
      .sort({ "dates.deliveryDate": 1 })
      .cursor();

    for (
      let bill = await billCursor.next();
      bill != null;
      bill = await billCursor.next()
    ) {
      const baseTransaction = {
        date: bill.dates.deliveryDate,
        gstType: "GST OUTPUT",
        gstFor: "SALES",
        documentNumber: bill.billNo,
      };

      // Process each line item
      for (const lineItem of bill.lineItems) {
        const product = await getProduct(lineItem.product);
        writeLineItemTransaction(baseTransaction, lineItem, product);
      }
    }

    // 3. Process GST INPUT from sales returns using cursor
    const salesReturnCursor = SalesReturn.find({
      distributorId: distributorId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("createdAt salesReturnNo lineItems")
      .sort({ createdAt: 1 })
      .cursor();

    for (
      let salesReturn = await salesReturnCursor.next();
      salesReturn != null;
      salesReturn = await salesReturnCursor.next()
    ) {
      const baseTransaction = {
        date: salesReturn.createdAt,
        gstType: "GST INPUT",
        gstFor: "SALES RETURN",
        documentNumber: salesReturn.salesReturnNo,
      };

      // Process each line item
      for (const lineItem of salesReturn.lineItems) {
        const product = await getProduct(lineItem.product);
        writeLineItemTransaction(baseTransaction, lineItem, product);
      }
    }

    // 4. Process GST OUTPUT from purchase returns using cursor
    const purchaseReturnCursor = PurchaseReturn.find({
      distributorId: distributorId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("createdAt code lineItems")
      .sort({ createdAt: 1 })
      .cursor();

    for (
      let purchaseReturn = await purchaseReturnCursor.next();
      purchaseReturn != null;
      purchaseReturn = await purchaseReturnCursor.next()
    ) {
      const baseTransaction = {
        date: purchaseReturn.createdAt,
        gstType: "GST OUTPUT",
        gstFor: "PURCHASE RETURN",
        documentNumber: purchaseReturn.code,
      };

      // Process each line item
      for (const lineItem of purchaseReturn.lineItems) {
        const product = await getProduct(lineItem.product);
        writeLineItemTransaction(baseTransaction, lineItem, product);
      }
    }

    // Add summary section
    csvStream.write({});

    // Summary rows
    csvStream.write({
      Date: "SUMMARY",
      "GST Type": "Total GST INPUT",
      "GST For": "",
      "Document Number": "",
      "Product Code": "",
      "HSN Code": "",
      "GST Rate": "",
      "Taxable Value": "",
      "CGST Amount": "",
      "SGST Amount": "",
      "IGST Amount": "",
      "Total GST": parseFloat(totalGstInput).toFixed(2),
      "Net Amount": "",
    });

    csvStream.write({
      Date: "",
      "GST Type": "Total GST OUTPUT",
      "GST For": "",
      "Document Number": "",
      "Product Code": "",
      "HSN Code": "",
      "GST Rate": "",
      "Taxable Value": "",
      "CGST Amount": "",
      "SGST Amount": "",
      "IGST Amount": "",
      "Total GST": parseFloat(totalGstOutput).toFixed(2),
      "Net Amount": "",
    });

    csvStream.end();
  } catch (error) {
    console.error("GST Input Output Report Error:", {
      error: error.message,
      stack: error.stack,
      distributorId: req.query.distributorId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      timestamp: new Date().toISOString(),
    });

    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GST Input Output Report Error</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
              color: #333;
            }
            .error-container {
              max-width: 600px;
              margin: 50px auto;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              overflow: hidden;
            }
            .error-header {
              background: #d32f2f;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .error-header h1 {
              margin: 0;
              font-size: 24px;
            }
            .error-content {
              padding: 30px;
            }
            .error-details {
              background: #f8f9fa;
              border-left: 4px solid #d32f2f;
              padding: 15px;
              margin: 20px 0;
              border-radius: 0 4px 4px 0;
            }
            .error-details p {
              margin: 8px 0;
            }
            .error-details strong {
              color: #d32f2f;
            }
            .retry-section {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
            }
            .retry-button {
              display: inline-block;
              background: #1976d2;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 4px;
              font-weight: 500;
              transition: background 0.3s;
            }
            .retry-button:hover {
              background: #1565c0;
            }
            .support-info {
              margin-top: 20px;
              font-size: 14px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <div class="error-header">
              <h1>⚠️ GST Input Output Report Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the GST input output report. Please check your parameters and try again.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Report Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Distributor ID:</strong> ${
                  req.query.distributorId || "N/A"
                }</p>
                <p><strong>Start Date:</strong> ${
                  req.query.startDate || "N/A"
                }</p>
                <p><strong>End Date:</strong> ${req.query.endDate || "N/A"}</p>
                <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              </div>
              
              <div class="retry-section">
                <a href="javascript:location.reload()" class="retry-button">🔄 Try Again</a>
                
                <div class="support-info">
                  <p>If this error continues, please contact technical support with the error details above.</p>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.status(500).send(errorHtml);
  }
});

module.exports = { gstInputOutputReport };
