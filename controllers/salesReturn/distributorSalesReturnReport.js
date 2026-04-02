const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const SalesReturn = require("../../models/salesReturn.model");

const distributorSalesReturnReport = asyncHandler(async (req, res) => {
  try {
    const { distributorId, retailerId, salesmanName, startDate, endDate } =
      req.query;

    // Validate required distributorId
    if (!distributorId) {
      res.status(400);
      throw new Error("Missing required field: distributorId");
    }

    // Set HTTP headers for CSV download - no filename
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment"); // Removed filename

    // --- Start Filtering Logic ---
    const filter = {
      distributorId: distributorId,
    };

    // Retailer filter
    if (retailerId) {
      filter.retailerId = retailerId;
    }

    // Salesman filter
    if (salesmanName) {
      filter.salesmanName = salesmanName;
    }

    // Date range filter for Sales Return creation date
    if (startDate && endDate) {
      const startOfDay = moment
        .tz(startDate, "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();

      if (startOfDay > endOfDay) {
        res.status(400);
        throw new Error("Start date cannot be after end date");
      }

      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }
    // --- End Filtering Logic ---

    // Define which related documents to populate
    const populateFields = [
      {
        path: "distributorId",
        select: "dbCode name RBPSchemeMapped city stateId",
        populate: {
          path: "stateId",
          select: "name zoneId",
          populate: {
            path: "zoneId",
            select: "name",
          },
        },
      },
      {
        path: "salesmanName",
        select: "empId name empMappingId",
        populate: {
          path: "empMappingId",
          select: "rmEmpId",
          populate: {
            path: "rmEmpId",
            select: "empId name",
          },
        },
      },
      { path: "retailerId", select: "outletUID outletName" },
      { path: "billId", select: " new_billno billNo dates orderNo" },
      {
        path: "lineItems.product",
        select:
          "product_code name sku_group_id product_hsn_code base_point brand subBrand",
        populate: [
          {
            path: "brand",
            select: "code name",
          },
          {
            path: "subBrand",
            select: "name",
          },
        ],
      },
      { path: "lineItems.price", select: "rlp_price" },
    ];

    // Define CSV headers
    const headers = [
      "Date",
      "Sales Return No",
      "Bill No",
      "Bill Delivery Date",
      "Order No",
      "Distributor Code",
      "Distributor Name",
      "Distributor's Zone",
      "Distributor's State",
      "Distributor's City",
      "Retailer UID",
      "Retailer Name",
      "Product Code",
      "Product Name",
      "SKU Group Code",
      "Brand Code",
      "Sub Brand",
      "Product HSN Code",
      "RLP",
      "Bill Qty",
      "Return Qty",
      "Gross Amount",
      "Taxable Amount",
      "CGST",
      "SGST",
      "IGST",
      "Net Amount",
      "Base Point",
      "Remark",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for memory-efficient processing of large datasets
    const cursor = SalesReturn.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .cursor();

    // Process each document from the cursor
    cursor.on("data", (salesReturn) => {
      // Create a new CSV row for each line item in the sales return
      salesReturn.lineItems.forEach((item) => {
        const isRBPSchemed =
          salesReturn?.distributorId?.RBPSchemeMapped === "yes";
        const basePoint = isRBPSchemed
          ? Number(
              Number(item?.usedBasePoint ?? item?.product?.base_point ?? 0) *
                Number(item?.returnQty ?? 0),
            )
          : 0;

        csvStream.write({
          Date: salesReturn.createdAt
            ? moment(salesReturn.createdAt)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY")
            : "",
          "Sales Return No": salesReturn.salesReturnNo || "",
          "Bill No":
            salesReturn.billId?.new_billno || salesReturn.billId?.billNo || "",
          "Bill Delivery Date": salesReturn.billId?.dates?.deliveryDate
            ? moment(salesReturn.billId.dates.deliveryDate)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY")
            : "",
          "Order No": salesReturn.billId?.orderNo || "",
          "Distributor Code": salesReturn.distributorId?.dbCode || "",
          "Distributor Name": salesReturn.distributorId?.name || "",
          "Distributor's Zone": salesReturn.distributorId?.stateId?.zoneId?.name || "",
          "Distributor's State": salesReturn.distributorId?.stateId?.name || "",
          "Distributor's City": salesReturn.distributorId?.city || "",
          "Retailer UID": salesReturn.retailerId?.outletUID || "",
          "Retailer Name": salesReturn.retailerId?.outletName || "",
          "Product Code": item.product?.product_code || "",
          "Product Name": item.product?.name || "",
          "SKU Group Code": item.product?.sku_group_id || "",
          "Brand Code": item.product?.brand?.code || "",
          "Sub Brand": item.product?.subBrand?.name || "",
          "Product HSN Code": item.product?.product_hsn_code || "",
          RLP: item.price?.rlp_price || 0,
          "Bill Qty": item.billQty || 0,
          "Return Qty": item.returnQty || 0,
          "Gross Amount": item.grossAmt || 0,
          "Taxable Amount": item.taxableAmt || 0,
          CGST: item.totalCGST || 0,
          SGST: item.totalSGST || 0,
          IGST: item.totalIGST || 0,
          "Net Amount": item.netAmt || 0,
          "Base Point": basePoint,
          Remark: item.salesReturnRemark || "",
        });
      });
    });

    // Finalize the CSV stream when the cursor is finished
    cursor.on("end", () => {
      csvStream.end();
    });

    // Handle any errors during the database query
    cursor.on("error", (err) => {
      console.error("Error during report generation cursor:", err);
      csvStream.end();
      if (!res.headersSent) {
        res.status(500).send("Error generating report");
      }
    });
  } catch (error) {
    console.error("Error in generateSalesReturnReport:", {
      error: error.message,
      stack: error.stack,
      distributorId: req.query.distributorId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      timestamp: new Date().toISOString(),
    });

    // Styled error HTML 
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sales Return Report Error</title>
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
              <h1>⚠️ Sales Return Report Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the sales return report. Please check your parameters and try again.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Sales Return Report Generation Error"
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

    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.status(500).send(errorHtml);
    }
  }
});

module.exports = { distributorSalesReturnReport };
