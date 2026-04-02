const asyncHandler = require("express-async-handler");
const SalesReturnModel = require("../../models/salesReturn.model");
const generateSalesReturnHTML = require("./util/generateSalesReturnHTML");
const DbBank = require("../../models/dbBank.model");
const DBRule = require("../../models/dbRule.model");
const axios = require("axios");

const salesReturnPrintPDF = asyncHandler(async (req, res) => {
  try {
    const { salesReturnId } = req.params;

    if (!salesReturnId) {
      res.status(400);
      throw new Error("Sales Return ID is required");
    }

    const salesReturn = await SalesReturnModel.findById(salesReturnId).populate(
      [
        {
          path: "distributorId",
          populate: [{ path: "stateId" }, { path: "brandId" }],
        },
        { path: "retailerId" },
        { path: "billId" },
        { path: "salesmanName" },
        { path: "routeId" },
        { path: "lineItems.product" },
        { path: "lineItems.price" },
        { path: "lineItems.inventoryId" },
      ],
    );

    if (!salesReturn) {
      res.status(404);
      throw new Error("Sales Return not found");
    }

    const distributorId = salesReturn?.distributorId?._id;

    // Fetch bank details
    salesReturn.bankData = await DbBank.findOne({ distributorId }).populate(
      "distributorId",
    );

    // Fetch terms and conditions
    const termConditions = await DBRule.findOne({
      dbId: distributorId,
      module: "Sales Return T&C",
    });

    salesReturn.termConditions = termConditions?.rules || [];

    // Fetch logo and convert to base64
    let logoBase64 = null;
    const logoUrl = "https://firebasestorage.googleapis.com/v0/b/lux-file-storage.appspot.com/o/dms%2Fdms_1749812986881.png?alt=media";
    
    try {
      const response = await axios.get(logoUrl, {
        responseType: "arraybuffer",
        timeout: 5000,
      });
      const base64 = Buffer.from(response.data).toString("base64");
      logoBase64 = `data:image/png;base64,${base64}`;
    } catch (logoError) {
      console.error("Failed to fetch logo:", logoError.message);
    }

    // Generate HTML
    let htmlContent = generateSalesReturnHTML(salesReturn, { logoBase64 });

    // Inject auto-print script and buttons just before </body>
    // Using CSP-compliant approach with addEventListener
    const autoPrintScript = `
      <style>
        @media print {
          .print-btn, .close-btn { display: none; }
        }
        .print-btn, .close-btn {
          position: fixed;
          top: 20px;
          z-index: 9999;
          background: #1976d2;
          color: #fff;
          border: none;
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 16px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          transition: background 0.2s;
          margin-left: 8px;
        }
        .print-btn:hover, .close-btn:hover {
          background: #1565c0;
        }
        .print-btn {
          right: 100px;
        }
        .close-btn {
          right: 20px;
          background: #d32f2f;
        }
        .close-btn:hover {
          background: #b71c1c;
        }
      </style>
      <button id="printBtn" class="print-btn">🖨️ Print</button>
      <button id="closeBtn" class="close-btn">✖ Close</button>
      <script id="auto-print-script">
        window.onload = function() {
          document.getElementById('printBtn').addEventListener('click', function() { window.print(); });
          document.getElementById('closeBtn').addEventListener('click', function() { window.close(); });
          window.print();
        };
        document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      </script>
    `;

    if (htmlContent.includes("</body>")) {
      htmlContent = htmlContent.replace("</body>", `${autoPrintScript}</body>`);
    } else {
      htmlContent += autoPrintScript;
    }

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' https://firebasestorage.googleapis.com data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:;");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(htmlContent);
  } catch (error) {
    console.error("Sales Return HTML Generation Error:", {
      error: error.message,
      stack: error.stack,
      salesReturnId: req.params.salesReturnId,
      timestamp: new Date().toISOString(),
    });

    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Print Preview Generation Error</title>
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
              <h1>⚠️ Print Preview Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating your sales return print preview. Please try again or contact support if the issue persists.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "HTML Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Sales Return ID:</strong> ${req.params.salesReturnId}</p>
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

    res.status(500).send(errorHtml);
  }
});

module.exports = { salesReturnPrintPDF };
