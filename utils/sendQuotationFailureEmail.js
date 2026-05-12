const sendEmail = require("./sendEmail");

/**
 * Send consolidated email notification on SAP quotation status fetch failures
 * @param {Object} failureSummary - Summary of failures
 * @param {Array} failureSummary.notFoundPOs - Array of POs not found in SAP
 * @param {Array} failureSummary.quotationFailures - Array of POs with API errors
 * @param {number} failureSummary.totalProcessed - Total POs processed
 * @param {number} failureSummary.totalSuccess - Total successful POs
 * @param {number} failureSummary.totalNotFound - Total POs not found by SAP
 * @param {number} failureSummary.totalErrors - Total POs with API errors
 */
const sendQuotationFailureEmail = async (failureSummary) => {
  try {
    const {
      notFoundPOs,
      quotationFailures,
      totalProcessed,
      totalSuccess,
      totalNotFound,
      totalErrors,
    } = failureSummary;

    const failureTime = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const hasFailures = notFoundPOs.length > 0 || quotationFailures.length > 0;

    if (!hasFailures) {
      return; // Don't send email if there are no failures
    }

    const subject = `⚠️ SAP Quotation Create Failures - ${totalNotFound + totalErrors} Failed`;

    const generateNotFoundRows = (notFoundPOs) => {
      return notFoundPOs
        .map(
          (po, index) => `
        <tr>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${index + 1}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px; font-weight: 600;">
            ${po.purchaseOrderNo || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${po.distributorCode || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${po.createdAt ? new Date(po.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #ffc107; font-size: 13px;">
            SAP could not create the quotation for this purchase order
          </td>
        </tr>
      `,
        )
        .join("");
    };

    const generateErrorRows = (quotationFailures) => {
      return quotationFailures
        .map(
          (failure, index) => `
        <tr>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${index + 1}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px; font-weight: 600;">
            ${failure.purchaseOrderNo || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${failure.distributorCode || "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 13px;">
            ${failure.createdAt ? new Date(failure.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "N/A"}
          </td>
          <td style="padding: 14px 15px; border-bottom: 1px solid #dee2e6; color: #dc3545; font-size: 13px; font-family: monospace; word-break: break-word; max-width: 300px;">
            ${failure.errorMessage || "Unknown error"}
          </td>
        </tr>
      `,
        )
        .join("");
    };

    const notFoundTable =
      notFoundPOs.length > 0
        ? `
              <h3 style="margin: 30px 0 15px 0; color: #333333; font-size: 18px; font-weight: 600;">
                📋 Purchase Orders Not Found in Create (${notFoundPOs.length})
              </h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8f9fa; border-radius: 6px;">
                <colgroup>
                  <col style="width: 50px;">
                  <col style="width: 180px;">
                  <col style="width: 130px;">
                  <col style="width: 130px;">
                  <col style="width: auto;">
                </colgroup>
                <thead>
                  <tr style="background-color: #e9ecef;">
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">#</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Purchase Order No</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Distributor Code</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Order Creation Date</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${generateNotFoundRows(notFoundPOs)}
                </tbody>
              </table>
        `
        : "";

    const errorTable =
      quotationFailures.length > 0
        ? `
              <h3 style="margin: 30px 0 15px 0; color: #333333; font-size: 18px; font-weight: 600;">
                🚨 API Errors During Create (${quotationFailures.length})
              </h3>
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8f9fa; border-radius: 6px;">
                <colgroup>
                  <col style="width: 50px;">
                  <col style="width: 180px;">
                  <col style="width: 130px;">
                  <col style="width: 130px;">
                  <col style="width: auto;">
                </colgroup>
                <thead>
                  <tr style="background-color: #e9ecef;">
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">#</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Purchase Order No</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Distributor Code</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Order Creation Date</th>
                    <th style="padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6;">Error Message</th>
                  </tr>
                </thead>
                <tbody>
                  ${generateErrorRows(quotationFailures)}
                </tbody>
              </table>
        `
        : "";

    const htmlMessage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAP Quotation Create Failure Summary</title>
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
                ⚠️ SAP Quotation Create Report
              </h1>
              <p style="margin: 10px 0 0 0; color: #000000; font-size: 14px;">
                RUPA Distribution Management System — ${failureTime}
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
                The following issues were encountered during the SAP quotation creation process:
              </p>

              <!-- Summary -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8f9fa; border-radius: 6px;">
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 14px; font-weight: 600;">Total Processed</td>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 14px;">${totalProcessed}</td>
                </tr>
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 14px; font-weight: 600;">Successful</td>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #28a745; font-size: 14px; font-weight: 600;">${totalSuccess}</td>
                </tr>
                <tr>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #333333; font-size: 14px; font-weight: 600;">Not Found in Create</td>
                  <td style="padding: 15px; border-bottom: 1px solid #dee2e6; color: #ffc107; font-size: 14px; font-weight: 600;">${totalNotFound}</td>
                </tr>
                <tr>
                  <td style="padding: 15px; color: #333333; font-size: 14px; font-weight: 600;">Create Errors</td>
                  <td style="padding: 15px; color: #dc3545; font-size: 14px; font-weight: 600;">${totalErrors}</td>
                </tr>
              </table>

              ${notFoundTable}
              ${errorTable}

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
      email: "raju.order@rupa.co.in,order@rupa.co.in",
      cc: ["rohit.it@rupa.co.in", "Raju.it@rupa.co.in"],
      subject,
      htmlMessage,
    });
  } catch (emailError) {
    console.error(
      `Failed to send quotation status fetch failure summary email:`,
      emailError.message,
    );
  }
};

module.exports = sendQuotationFailureEmail;
