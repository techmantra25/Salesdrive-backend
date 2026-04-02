const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");
const { transactionCode } = require("../../utils/codeGenerator");
const { acquireLock, releaseLock } = require("../../models/lock.model");

const {
  adjustSingleProduct,
  createGRNRewardPoints,
} = require("./helpers/invoiceAdjustment.helper");

/**
 * CRON CONTROLLER
 * Retry all failed invoice product adjustments (bulk)
 */
const cronRetryAllFailedInvoiceAdjustments = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  console.log(
    "🚀 [CRON][INVOICE-RETRY] Job started at",
    new Date().toISOString()
  );

  const summary = {
    distributorsProcessed: 0,
    invoicesProcessed: 0,
    invoicesSkipped: 0,
    invoicesFullyResolved: 0,
    invoicesPartiallyResolved: 0,
    invoicesStillFailed: 0,
    totalProductsRetried: 0,
    totalProductsSuccess: 0,
    totalProductsFailed: 0,
    grnOnlyRetries: 0,
    grnSuccess: 0,
    grnFailed: 0,
    errors: [],
  };

  try {
    // 1️Fetch invoices with failed adjustments OR failed GRN
    const invoices = await Invoice.find({
      status: "Partially-Adjusted",
      $or: [
        { "lineItems.adjustmentStatus": "failed" },
        { grnStatus: "failed" },
      ],
    }).populate("distributorId", "dbCode RBPSchemeMapped");

    if (!invoices.length) {
      console.log("[CRON][INVOICE-RETRY] No failed invoices found");

      return res.status(200).json({
        status: 200,
        message: "No failed invoice adjustments found",
        summary,
        executionTime: `${Date.now() - startTime}ms`,
      });
    }

    console.log(
      `[CRON][INVOICE-RETRY] Found ${invoices.length} invoices to process`
    );

    // Group invoices by distributor
    const invoicesByDistributor = invoices.reduce((acc, invoice) => {
      const distId = String(invoice.distributorId._id || invoice.distributorId);
      if (!acc[distId]) acc[distId] = [];
      acc[distId].push(invoice);
      return acc;
    }, {});

    // Process distributor-wise
    for (const distributorId of Object.keys(invoicesByDistributor)) {
      summary.distributorsProcessed++;

      const distributor = await Distributor.findById(distributorId).lean();
      const distributorCode = distributor?.dbCode || distributorId;
      const rbpMapped = distributor?.RBPSchemeMapped === "yes";

      console.log(
        `[CRON][DISTRIBUTOR] Processing: ${distributorCode} (RBP: ${
          rbpMapped ? "YES" : "NO"
        })`
      );

      for (const invoice of invoicesByDistributor[distributorId]) {
        const lockName = `invoice-update-${invoice._id}`;

        // Try to acquire lock with timeout
        if (!(await acquireLock(lockName))) {
          console.warn(
            `[CRON][SKIP] Invoice ${invoice.invoiceNo} locked, skipping`
          );
          summary.invoicesSkipped++;
          continue;
        }

        try {
          summary.invoicesProcessed++;

          console.log(
            `[CRON][START] Invoice ${invoice.invoiceNo} | Distributor ${distributorCode}`
          );

          const failedItems = invoice.lineItems.filter(
            (li) => li.adjustmentStatus === "failed"
          );

          const hasFailedProducts = failedItems.length > 0;
          const hasFailedGRN = invoice.grnStatus === "failed" && rbpMapped;

          let productSuccessCount = 0;
          let productFailCount = 0;

          // PRODUCT ADJUSTMENT RETRY
          if (hasFailedProducts) {
            const stockId = await transactionCode("LXSTA");

            for (let i = 0; i < invoice.lineItems.length; i++) {
              const item = invoice.lineItems[i];

              if (item.adjustmentStatus === "success") {
                productSuccessCount++;
                continue;
              }

              summary.totalProductsRetried++;

              try {
                const result = await adjustSingleProduct(
                  item,
                  invoice,
                  distributorId,
                  stockId
                );

                // Handle skipped (already adjusted)
                if (result?.skipped) {
                  invoice.lineItems[i].adjustmentStatus = "success";
                  invoice.lineItems[i].adjustmentError = null;
                  productSuccessCount++;
                  summary.totalProductsSuccess++;
                  continue;
                }

                invoice.lineItems[i].adjustmentStatus = "success";
                invoice.lineItems[i].adjustmentError = null;
                invoice.lineItems[i].adjustmentAttempts =
                  (invoice.lineItems[i].adjustmentAttempts || 0) + 1;
                invoice.lineItems[i].lastAdjustmentAttempt = new Date();

                productSuccessCount++;
                summary.totalProductsSuccess++;
              } catch (error) {
                invoice.lineItems[i].adjustmentStatus = "failed";
                invoice.lineItems[i].adjustmentError = error.message;
                invoice.lineItems[i].adjustmentAttempts =
                  (invoice.lineItems[i].adjustmentAttempts || 0) + 1;
                invoice.lineItems[i].lastAdjustmentAttempt = new Date();

                productFailCount++;
                summary.totalProductsFailed++;

                console.error(
                  `[CRON][PRODUCT-FAIL] Invoice ${invoice.invoiceNo} | Product ${item.product} | ${error.message}`
                );

                summary.errors.push({
                  invoice: invoice.invoiceNo,
                  distributor: distributorCode,
                  product: item.product,
                  error: error.message,
                });
              }
            }

            // Update adjustment summary
            invoice.adjustmentSummary = {
              totalProducts: invoice.lineItems.length,
              successfulAdjustments: productSuccessCount,
              failedAdjustments: productFailCount,
              lastRetryAttempt: new Date(),
              needsRetry: productFailCount > 0,
            };
          } else {
            // All products already succeeded
            productSuccessCount = invoice.lineItems.length;
          }

          // GRN RETRY (only if all products succeeded)
          if (productFailCount === 0 && hasFailedGRN) {
            summary.grnOnlyRetries++;

            try {
              await createGRNRewardPoints(invoice);

              if (invoice.grnStatus === "success") {
                summary.grnSuccess++;
                console.log(
                  `[CRON][GRN-SUCCESS] Invoice ${invoice.invoiceNo} | Points credited`
                );
              } else if (invoice.grnStatus === "failed") {
                summary.grnFailed++;
                console.error(
                  `[CRON][GRN-FAIL] Invoice ${invoice.invoiceNo} | ${
                    invoice.grnError || "Unknown error"
                  }`
                );

                summary.errors.push({
                  invoice: invoice.invoiceNo,
                  distributor: distributorCode,
                  type: "GRN",
                  error: invoice.grnError || "GRN creation failed",
                });
              }
            } catch (error) {
              invoice.grnStatus = "failed";
              invoice.grnError = error.message;
              invoice.grnAttempts = (invoice.grnAttempts || 0) + 1;
              invoice.lastGrnAttempt = new Date();

              summary.grnFailed++;

              console.error(
                `[CRON][GRN-ERROR] Invoice ${invoice.invoiceNo} | ${error.message}`
              );

              summary.errors.push({
                invoice: invoice.invoiceNo,
                distributor: distributorCode,
                type: "GRN",
                error: error.message,
              });
            }
          } else if (productFailCount === 0 && !hasFailedGRN && rbpMapped) {
            // All products succeeded, no GRN issues, but ensure GRN is created
            await createGRNRewardPoints(invoice);
          }

          // DETERMINE FINAL STATUS
          const grnFailed = invoice.grnStatus === "failed";

          if (productFailCount === 0 && !grnFailed) {
            invoice.status = "Confirmed";
            summary.invoicesFullyResolved++;

            console.log(
              `[CRON][FULLY-RESOLVED] Invoice ${invoice.invoiceNo} | Products: ${productSuccessCount}, GRN: ${invoice.grnStatus}`
            );
          } else if (
            productFailCount < failedItems.length ||
            (hasFailedGRN && !grnFailed)
          ) {
            invoice.status = "Partially-Adjusted";
            summary.invoicesPartiallyResolved++;

            console.log(
              `[CRON][PARTIALLY-RESOLVED] Invoice ${invoice.invoiceNo} | Success: ${productSuccessCount}, Failed: ${productFailCount}, GRN: ${invoice.grnStatus}`
            );
          } else {
            invoice.status = "Partially-Adjusted";
            summary.invoicesStillFailed++;

            console.log(
              `[CRON][STILL-FAILED] Invoice ${invoice.invoiceNo} | Success: ${productSuccessCount}, Failed: ${productFailCount}, GRN: ${invoice.grnStatus}`
            );
          }

          await invoice.save();
        } catch (error) {
          console.error(
            `[CRON][INVOICE-ERROR] Invoice ${invoice.invoiceNo} | ${error.message}`
          );

          summary.errors.push({
            invoice: invoice.invoiceNo,
            distributor: distributorCode,
            type: "INVOICE",
            error: error.message,
          });
        } finally {
          await releaseLock(lockName);
        }
      }
    }

    const executionTime = Date.now() - startTime;

    console.log("[CRON][INVOICE-RETRY] Job completed", {
      ...summary,
      executionTime: `${executionTime}ms`,
    });

    return res.status(200).json({
      status: 200,
      message: "Cron retry for failed invoice adjustments completed",
      summary: {
        ...summary,
        errors: summary.errors.slice(0, 100), // Limit errors to first 100
      },
      executionTime: `${executionTime}ms`,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CRON][FATAL-ERROR]", error);

    return res.status(500).json({
      status: 500,
      message: "Cron job failed",
      error: error.message,
      summary,
      executionTime: `${Date.now() - startTime}ms`,
    });
  }
});

module.exports = {
  cronRetryAllFailedInvoiceAdjustments,
};
