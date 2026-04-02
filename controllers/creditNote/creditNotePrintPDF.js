const asyncHandler = require("express-async-handler");
const CreditNoteModel = require("../../models/creditNote.model");
const generateCreditNoteHTML = require("./util/generateCreditNoteHTML");
const DbBank = require("../../models/dbBank.model");
const DBRule = require("../../models/dbRule.model");

const creditNotePrintPDF = asyncHandler(async (req, res) => {
  try {
    const { creditNoteId } = req.params;

    if (!creditNoteId) {
      res.status(400);
      throw new Error("Credit Note ID is required");
    }

    const creditNote = await CreditNoteModel.findById(creditNoteId).populate([
      {
        path: "distributorId",
        populate: [{ path: "stateId" }, { path: "brandId" }],
      },
      { path: "outletId" },
      { path: "billId" },
      {
        path: "salesReturnId",
        populate: { path: "lineItems.product" },
      },
      { path: "lineItems.product" },
      { path: "lineItems.price" },
      { path: "lineItems.inventoryId" },
      { path: "lineItems.adjustmentId" },
      { path: "adjustedBillIds.billId" },
      { path: "adjustedBillIds.orderId" },
      { path: "adjustedBillIds.collectionId" },
    ]);

    if (!creditNote) {
      res.status(404);
      throw new Error("Credit Note not found");
    }

    const distributorId = creditNote?.distributorId?._id;

    creditNote.bankData = await DbBank.findOne({ distributorId }).populate(
      "distributorId",
    );

    const termConditions = await DBRule.findOne({
      dbId: distributorId,
      module: "Credit Note T&C",
    });

    creditNote.termConditions = termConditions?.rules || [];

    if (creditNote.lineItems?.length) {
      creditNote.totalLines = creditNote.lineItems.length;
    }

    // Generate HTML
    let htmlContent = generateCreditNoteHTML(creditNote);

    // Inject auto-print script and buttons just before </body>
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
      <button onclick="window.print()" class="print-btn">🖨️ Print</button>
      <button onclick="window.close()" class="close-btn">✖ Close</button>
      <script>
        window.onload = function() {
          window.print();
        };
        // Disable right-click context menu
        document.addEventListener('contextmenu', function(e) {
          e.preventDefault();
        });
      </script>
    `;

    if (htmlContent.includes("</body>")) {
      htmlContent = htmlContent.replace("</body>", `${autoPrintScript}</body>`);
    } else {
      htmlContent += autoPrintScript;
    }

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(htmlContent);
  } catch (error) {
    console.error("Credit Note HTML Generation Error:", {
      error: error.message,
      stack: error.stack,
      creditNoteId: req.params.creditNoteId,
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
              <p>We encountered an error while generating your credit note print preview. Please try again or contact support if the issue persists.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "HTML Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Credit Note ID:</strong> ${req.params.creditNoteId}</p>
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

module.exports = { creditNotePrintPDF };
