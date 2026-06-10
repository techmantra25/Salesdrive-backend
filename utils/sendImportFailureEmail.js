const sendEmail = require("./sendEmail");

/**
 * Send consolidated email notification on GRN import failures
 * @param {Object} failureSummary - Summary of import failures
 * @param {Array} failureSummary.msFailures - Array of MS brand failures
 * @param {Array} failureSummary.rupaFailures - Array of RUPA brand failures
 * @param {number} failureSummary.totalProcessed - Total invoices processed
 * @param {number} failureSummary.totalSuccess - Total successful imports
 * @param {number} failureSummary.totalFailed - Total failed imports
 */
const sendImportFailureEmail = async (failureSummary) => {
  try {
    const {
      msFailures,
      rupaFailures,
      totalProcessed,
      totalSuccess,
      totalFailed,
    } = failureSummary;

    const failureTime = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const hasFailures = msFailures.length > 0 || rupaFailures.length > 0;

    if (!hasFailures) {
      return; // Don't send email if there are no failures
    }

    const subject = `⚠️ GRN Import Failures - ${totalFailed} Failed`;

    const generateFailureRows = (failures, brand) => {
      return failures
        .map(
          (failure, index) => `
        <tr>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${index + 1}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px; font-weight: 600;">
            ${failure.invoiceNumber || failure.orderId || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${failure.distributorCode || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${brand}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #dc3545; font-size: 13px; font-family: monospace; word-break: break-word; max-width: 300px;">
            ${failure.errorMessage || "No error message"}
          </td>
        </tr>
      `,
        )
        .join("");
    };

    const htmlMessage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GRN Import Failure Summary</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 1000px; width: 100%; border-collapse: collapse; background-color: #ffffff; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); border-radius: 8px; overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #000000; font-size: 24px; font-weight: 600;">
                ⚠️ GRN Import Failures
              </h1>
              <p style="margin: 10px 0 0 0; color: #000000; font-size: 14px;">
                RUPA Distribution Management System
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                Dear Administrator,
              </p>

              <p style="margin: 0 0 20px 0; color: #666666; font-size: 15px; line-height: 1.6;">
                The following GRN imports failed during the import process:
              </p>

              <!-- Summary Stats -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 25px 0; background-color: #f8f9fa; border-radius: 6px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6; color: #6c757d; font-size: 13px; font-weight: 500;">
                          🕐 Process Completed At
                        </td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 14px; text-align: right; font-weight: 600;">
                          ${failureTime}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; color: #dc3545; font-size: 13px; font-weight: 500;">
                          ❌ Failed Imports
                        </td>
                        <td style="padding: 10px 0; color: #dc3545; font-size: 14px; text-align: right; font-weight: 600;">
                          ${totalFailed}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${
                msFailures.length > 0
                  ? `
              <!-- MS Brand Failures -->
              <h3 style="margin: 30px 0 15px 0; color: #333333; font-size: 18px; font-weight: 600;">
                📦 MS Brand Failures (${msFailures.length} ${msFailures[0]?.invoiceNumber ? "invoices" : "orders"})
              </h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8f9fa; border-radius: 6px;">
                <colgroup>
                  <col style="width: 50px;">
                  <col style="width: 150px;">
                  <col style="width: 150px;">
                  <col style="width: 100px;">
                  <col style="width: auto;">
                </colgroup>
                <thead>
                  <tr style="background-color: #e9ecef;">
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">#</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">${msFailures[0]?.invoiceNumber ? "Invoice Number" : "Order ID"}</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Distributor Code</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Brand</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${generateFailureRows(msFailures, "MS")}
                </tbody>
              </table>
              `
                  : ""
              }

              ${
                rupaFailures.length > 0
                  ? `
              <!-- ${rupaFailures[0]?.brand || "RUPA"} Failures -->
              <h3 style="margin: 30px 0 15px 0; color: #333333; font-size: 18px; font-weight: 600;">
                📦 ${rupaFailures[0]?.brand || "RUPA"} Failures (${rupaFailures.length} ${rupaFailures[0]?.invoiceNumber ? "invoices" : "orders"})
              </h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8f9fa; border-radius: 6px;">
                <colgroup>
                  <col style="width: 50px;">
                  <col style="width: 150px;">
                  <col style="width: 150px;">
                  <col style="width: 100px;">
                  <col style="width: auto;">
                </colgroup>
                <thead>
                  <tr style="background-color: #e9ecef;">
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">#</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">${rupaFailures[0]?.invoiceNumber ? "Invoice Number" : "Order ID"}</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Distributor Code</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Brand</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${generateFailureRows(rupaFailures, rupaFailures[0]?.brand || "RUPA")}
                </tbody>
              </table>
              `
                  : ""
              }


              <p style="margin: 20px 0 0 0; color: #666666; font-size: 14px; line-height: 1.6;">
                This is an automated notification from the RUPA DMS system.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #dee2e6;">
              <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 13px;">
                <strong>RUPA DMS</strong> - Distribution Management System
              </p>
              <p style="margin: 0; color: #868e96; font-size: 12px;">
                © ${new Date().getFullYear()} RUPA DMS. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await sendEmail({
      email: "Raju.it@rupa.co.in",
      cc: ["rohit.it@rupa.co.in", "Bikram.it@rupa.co.in"],
      subject,
      htmlMessage,
    });
  } catch (emailError) {
    console.error(
      `Failed to send import failure summary email:`,
      emailError.message,
    );
  }
};

module.exports = sendImportFailureEmail;
