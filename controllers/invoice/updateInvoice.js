const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Inventory = require("../../models/inventory.model");
const {updatePrimaryTargetAchievement} = require("../bill/util/updatePrimaryTargetAchievement.js");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const {
  transactionCode,
  invoiceNumberGenerator,
  generateCode,
} = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");
const {
  createStockLedgerEntry,
} = require("../../controllers/transction/createStockLedgerEntry");

/* HELPERS */
async function adjustSingleProduct(item, invoice, distributorId, stockId) {
  if (item.receivedQty <= 0) {
    return { skipped: true };
  }

  // Better idempotency check using the unique index fields
  const existingTxn = await Transaction.findOne({
    invoiceId: invoice._id,
    invoiceLineItemId: item._id,
    transactionType: "invoice",
  });

  if (existingTxn) {
    return { skipped: true };
  }

  // validate product
  const product = await Product.findById(item.product);
  if (!product) {
    throw new Error("Product not found");
  }

  // validate pricing
  const priceResp = await axios.get(
    `${SERVER_URL}/api/v1/price/product-pricing/${item.product}?distributorId=${distributorId}`,
  );

  if (!priceResp?.data?.data?.length) {
    throw new Error("Price not found");
  }

  const priceEntry = priceResp.data.data[0];

  // Calculate RLP and DLP price per piece or box (from previous code)
  let rlpbyPcs = 0;
  let dlpbyPcs = 0;
  if (product.uom === "box") {
    const piecesPerBox = product.no_of_pieces_in_a_box || 1;
    rlpbyPcs = priceEntry.rlp_price / piecesPerBox;
    dlpbyPcs = priceEntry.dlp_price / piecesPerBox;
  } else {
    rlpbyPcs = priceEntry.rlp_price || 0;
    dlpbyPcs = priceEntry.dlp_price || 0;
  }

  // Get or create inventory item

  let inventory = await Inventory.findOne({
    productId: item.product,
    distributorId: distributorId,
    godownType: "main",
  });

  if (!inventory) {
    // Create new inventory if not exists
    const inventoryItemId = await generateCode("INVT");

    inventory = new Inventory({
      productId: item.product,
      distributorId: distributorId,
      invitemId: inventoryItemId,
      availableQty: 0,
      damagedQty: 0,
      totalStockamtDlp: 0,
      totalStockamtRlp: 0,
      godownType: "main",
    });
    await inventory.save();
  }

  // Update inventory quantities (from previous code)
  inventory.availableQty += item.receivedQty;
  inventory.damagedQty += item.damageQty || 0;
  inventory.totalStockamtDlp += dlpbyPcs * item.receivedQty;
  inventory.totalStockamtRlp += rlpbyPcs * item.receivedQty;
  await inventory.save();

  // create transaction with all required fields
  const transaction = new Transaction({
    distributorId,
    productId: item.product,
    invItemId: inventory._id, // REQUIRED field
    transactionId: stockId,
    qty: item.receivedQty,
    date: new Date(),
    type: "In",
    balanceCount: inventory.availableQty, // REQUIRED field
    description: `Invoice ${invoice.invoiceNo} - Stock received`,
    transactionType: "invoice",
    stockType: "salable",
    invoiceId: invoice._id,
    invoiceLineItemId: item._id,
    billLineItemId: null,
  });

  await transaction.save();

  // Create stock ledger entry for invoice
  try {
    await createStockLedgerEntry(transaction._id);
  } catch (error) {
    console.error(
      `Stock ledger creation failed for transaction ${transaction._id}:`,
      error.message,
    );
    // Don't throw - allow invoice confirmation to continue
  }

  return { success: true };
}

/* ------------------------------------------------------------------ */
/* GRN (ATOMIC, NO PARTIAL) */
/* ------------------------------------------------------------------ */

async function createGRNRewardPoints(invoice) {
  if (invoice.grnStatus === "success") return;

  const distributor = await Distributor.findById(invoice.distributorId).lean();
  if (!distributor || distributor.RBPSchemeMapped !== "yes") {
    invoice.grnStatus = "not-applicable";
    return;
  }

  const hasPending = invoice.lineItems.some(
    (li) => li.adjustmentStatus !== "success",
  );
  if (hasPending) {
    invoice.grnStatus = "failed";
    invoice.grnError = "Cannot create GRN: Some products are not adjusted";
    return;
  }

  const existingGRN = await DistributorTransaction.findOne({
    invoiceId: invoice._id,
    transactionFor: "GRN",
    status: "Success",
  });

  if (existingGRN) {
    invoice.grnStatus = "success";
    return;
  }

  let points = 0;
  for (const li of invoice.lineItems) {
    const product = await Product.findById(li.product).lean();
    const bp = Number(li.usedBasePoint ?? product?.base_point ?? 0);
    if (bp > 0) points += bp * li.receivedQty;
  }

  if (points <= 0) {
    invoice.grnStatus = "not-applicable";
    invoice.grnError = "No reward points calculated";
    return;
  }

  try {
    const lastTxn = await DistributorTransaction.findOne({
      distributorId: invoice.distributorId,
    }).sort({ createdAt: -1 });

    const balance = lastTxn ? lastTxn.balance + points : points;

    await DistributorTransaction.create({
      distributorId: invoice.distributorId,
      transactionType: "credit",
      transactionFor: "GRN",
      point: points,
      balance,
      invoiceId: invoice._id,
      billId: null,
      salesReturnId: null,
      purchaseReturnId: null,
      retailerId: null,
      status: "Success",
      remark: `Reward points for GRN ${invoice.grnNumber} with invoice no ${invoice.invoiceNo} for DB Code ${distributor.dbCode}`,
    });

    invoice.grnStatus = "success";
    invoice.grnError = null;
  } catch (error) {
    invoice.grnStatus = "failed";
    invoice.grnError = error.message;

    // Increment attempt counter
    invoice.grnAttempts = (invoice.grnAttempts || 0) + 1;
    invoice.lastGrnAttempt = new Date();

    console.error(
      `❌ [GRN-ERROR] Invoice ${invoice.invoiceNo} | ${error.message}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* UPDATE / CONFIRM INVOICE */
/* ------------------------------------------------------------------ */

const updateInvoice = asyncHandler(async (req, res) => {
  const { inId } = req.params;
  const distributorId = req.user._id;
  const lockName = `invoice-update-${inId}`;

  const existingInvoice = await Invoice.findById(inId);
  if (!existingInvoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  // Ensure invoice belongs to logged-in distributor
  if (existingInvoice.distributorId.toString() !== distributorId.toString()) {
    return res.status(403).json({ message: "Unauthorized access to invoice" });
  }

  // CONFIRMATION VALIDATION (NO LOCK)
  if (
    req.body.status === "Confirmed" &&
    existingInvoice.status !== "Confirmed"
  ) {
    const validationErrors = [];
    for (const li of existingInvoice.lineItems) {
      const product = await Product.findById(li.product);
      if (!product) {
        validationErrors.push({
          productId: li.product,
          productCode: "Unknown",
          error: "Product not found",
        });
        continue;
      }

      // Check price availability
      try {
        const priceResp = await axios.get(
          `${SERVER_URL}/api/v1/price/product-pricing/${li.product}?distributorId=${distributorId}`,
        );

        if (!priceResp?.data?.data?.length) {
          validationErrors.push({
            productId: li.product,
            productCode: product.product_code || "Unknown",
            error: "Price not found for product",
          });
        }
      } catch (priceError) {
        validationErrors.push({
          productId: li.product,
          productCode: product.product_code || "Unknown",
          error: "Failed to fetch price for product",
        });
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: `Cannot confirm invoice. ${validationErrors.length} products have errors`,
        errors: validationErrors,
        errorCount: validationErrors.length,
      });
    }

    req.body.grnDate = new Date();
    req.body.grnNumber = await invoiceNumberGenerator("GRN", distributorId);
  }

  // SAVE BASIC UPDATE
  const updatedInvoice = await Invoice.findByIdAndUpdate(inId, req.body, {
    new: true,
  });

  // NO ADJUSTMENT REQUIRED
  if (!["Confirmed", "Partially-Adjusted"].includes(updatedInvoice.status)) {
    return res.json({ status: 200, data: updatedInvoice });
  }

  // LOCK ONLY ADJUSTMENT
  if (!(await acquireLock(lockName))) {
    return res.status(409).json({
      message: "Invoice adjustment already in progress",
    });
  }

  try {
    const stockId = await transactionCode("LXSTA");
    let success = 0;
    let failed = 0;

    for (const li of updatedInvoice.lineItems) {
      if (li.adjustmentStatus === "success") {
        success++;
        continue;
      }

      try {
        const result = await adjustSingleProduct(
          li,
          updatedInvoice,
          distributorId,
          stockId,
        );

        // skipped = already adjusted historically → SUCCESS
        if (result?.skipped) {
          li.adjustmentStatus = "success";
          li.adjustmentError = null;
          success++;
          continue;
        }

        li.adjustmentStatus = "success";
        li.adjustmentError = null;
        success++;
      } catch (err) {
        li.adjustmentStatus = "failed";
        li.adjustmentError = err.message;
        failed++;
      }
    }

    updatedInvoice.adjustmentSummary = {
      totalProducts: updatedInvoice.lineItems.length,
      successfulAdjustments: success,
      failedAdjustments: failed,
      lastRetryAttempt: new Date(),
      needsRetry: failed > 0,
    };

    // updatedInvoice.status = failed === 0 ? "Confirmed" : "Partially-Adjusted";

    if (failed === 0) {
      await createGRNRewardPoints(updatedInvoice);
    }

    // Check if GRN failed (only relevant if RBP is mapped)
    const grnFailed = updatedInvoice.grnStatus === "failed";

    // Status logic: Partially-Adjusted if either products failed OR GRN failed
    // if (failed === 0 && !grnFailed) {
    //   updatedInvoice.status = "Confirmed";
    // } else {
    //   updatedInvoice.status = "Partially-Adjusted";
    // }


    // Status logic
if (failed === 0 && !grnFailed) {
  updatedInvoice.status = "Confirmed";

  // CALL PRIMARY TARGET ACHIEVEMENT UPDATE HERE
  await updatePrimaryTargetAchievement({
   
 distributorId: distributorId,
  invoiceId: updatedInvoice._id,
  billDate: updatedInvoice.createdAt,
  totalBillValue: updatedInvoice.totalInvoiceAmount,
  lineItems: updatedInvoice.lineItems,
  });
} else {
  updatedInvoice.status = "Partially-Adjusted";
}


    await updatedInvoice.save();

    return res.json({
      status: 200,
      message:
        failed === 0
          ? "Invoice confirmed successfully"
          : "Invoice partially adjusted",
      adjustmentSummary: {
        total: updatedInvoice.lineItems.length,
        success,
        failed,
        needsRetry: failed > 0,
      },
      data: updatedInvoice,
    });
  } finally {
    await releaseLock(lockName);
  }
});

/* ------------------------------------------------------------------ */
/* RETRY ADJUSTMENTS */
/* ------------------------------------------------------------------ */

const retryInvoiceAdjustments = asyncHandler(async (req, res) => {
  const { inId } = req.params;
  const distributorId = req.user._id;
  const lockName = `invoice-update-${inId}`;

  const invoice = await Invoice.findById(inId);
  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  // Ensure invoice belongs to logged-in distributor
  if (invoice.distributorId.toString() !== distributorId.toString()) {
    return res.status(403).json({ message: "Unauthorized access to invoice" });
  }

  const failedItems = invoice.lineItems.filter(
    (li) => li.adjustmentStatus === "failed",
  );

  // GRN ONLY RETRY
  if (failedItems.length === 0 && invoice.grnStatus === "failed") {
    if (!(await acquireLock(lockName))) {
      return res.status(409).json({ message: "Invoice busy" });
    }

    try {
      await createGRNRewardPoints(invoice);
      const grnSuccess =
        invoice.grnStatus === "success" ||
        invoice.grnStatus === "not-applicable";

      // Update status: Confirmed only if GRN succeeded
      if (grnSuccess) {
        invoice.status = "Confirmed";
      } else {
        invoice.status = "Partially-Adjusted";
      }
      await invoice.save();
      // const grnSuccess =
      //   invoice.grnStatus === "success" ||
      //   invoice.grnStatus === "not-applicable";

      return res.json({
        message: grnSuccess ? "GRN retried successfully" : "GRN retry failed",
        adjustmentSummary: {
          total: invoice.lineItems.length,
          success: invoice.lineItems.length,
          failed: 0,
          needsRetry: !grnSuccess,
        },
        data: invoice,
      });
    } finally {
      await releaseLock(lockName);
    }
  }

  if (failedItems.length === 0) {
    return res.status(400).json({ message: "Nothing to retry" });
  }

  if (!(await acquireLock(lockName))) {
    return res.status(409).json({ message: "Invoice busy" });
  }

  try {
    const stockId = await transactionCode("LXSTA");
    let success = 0;
    let failed = 0;

    for (const li of invoice.lineItems) {
      if (li.adjustmentStatus === "success") {
        success++;
        continue;
      }

      try {
        const result = await adjustSingleProduct(
          li,
          invoice,
          distributorId,
          stockId,
        );

        if (result?.skipped) {
          li.adjustmentStatus = "success";
          li.adjustmentError = null;
          success++;
          continue;
        }

        li.adjustmentStatus = "success";
        li.adjustmentError = null;
        success++;
      } catch (err) {
        li.adjustmentStatus = "failed";
        li.adjustmentError = err.message;
        failed++;
      }
    }

    invoice.adjustmentSummary = {
      totalProducts: invoice.lineItems.length,
      successfulAdjustments: success,
      failedAdjustments: failed,
      lastRetryAttempt: new Date(),
      needsRetry: failed > 0,
    };

    // invoice.status = failed === 0 ? "Confirmed" : "Partially-Adjusted";

    if (failed === 0) {
      await createGRNRewardPoints(invoice);
    }

    // Check if GRN failed (only relevant if RBP is mapped)
    const grnFailed = invoice.grnStatus === "failed";

    // Status logic: Partially-Adjusted if either products failed OR GRN failed
    if (failed === 0 && !grnFailed) {
      invoice.status = "Confirmed";
    } else {
      invoice.status = "Partially-Adjusted";
    }

    await invoice.save();

    return res.json({
      message:
        failed === 0
          ? "Retry completed successfully"
          : "Retry partially failed",
      adjustmentSummary: {
        total: invoice.lineItems.length,
        success,
        failed,
        needsRetry: failed > 0,
      },
      data: invoice,
    });
  } finally {
    await releaseLock(lockName);
  }
});

module.exports = {
  updateInvoice,
  retryInvoiceAdjustments,
};

//Previous code:
// const asyncHandler = require("express-async-handler");
// const Invoice = require("../../models/invoice.model");
// const Transaction = require("../../models/transaction.model");
// const Inventory = require("../../models/inventory.model");
// const Product = require("../../models/product.model");
// const Distributor = require("../../models/distributor.model"); // **NEW: Added distributor import**
// const {
//   generateCode,
//   transactionCode,
//   invoiceNumberGenerator,
// } = require("../../utils/codeGenerator");
// const axios = require("axios");
// const { SERVER_URL } = require("../../config/server.config");
// const DistributorTransaction = require("../../models/distributorTransaction.model");
// const { acquireLock, releaseLock } = require("../../models/lock.model");

// const updateInvoice = asyncHandler(async (req, res) => {
//   // aquire lock for the invoice update
//   const { inId } = req.params;
//   const lockName = `invoice-update-${inId}`;
//   if (!(await acquireLock(lockName))) {
//     res.status(400);
//     throw new Error(
//       `Invoice update is already in progress for invoice ID: ${inId}`
//     );
//   }

//   try {
//     const date = new Date().toISOString();
//     const distributorId = req?.user?._id;

//     // First check if invoice exists
//     const existingInvoice = await Invoice.findById(inId);
//     if (!existingInvoice) {
//       return res.status(404).json({ message: "Invoice not found" });
//     } // If status is being changed to "Confirmed", validate all line items first
//     if (
//       req?.body?.status === "Confirmed" &&
//       existingInvoice.status !== "Confirmed"
//     ) {
//       // Collect all validation errors before returning
//       const validationErrors = [];

//       // Validate all line items have valid products and prices
//       for (const item of existingInvoice.lineItems) {
//         const { product } = item;

//         // Check if product exists
//         const productData = await Product.findOne({
//           _id: product,
//         });

//         if (!productData) {
//           validationErrors.push({
//             productId: product,
//             productCode: "Unknown",
//             error: `Product with ID ${product} not found`,
//           });
//           continue; // Skip to next item if product doesn't exist
//         }

//         // Check if price exists for the product
//         try {
//           const priceResponse = await axios.get(
//             `${SERVER_URL}/api/v1/price/product-pricing/${product._id}?distributorId=${distributorId}`
//           );

//           const priceEntry = priceResponse?.data?.data[0];

//           if (!priceEntry) {
//             validationErrors.push({
//               productId: product,
//               productCode: productData?.product_code || "Unknown",
//               error: `Price not found for product`,
//             });
//           }
//         } catch (priceError) {
//           validationErrors.push({
//             productId: product,
//             productCode: productData?.product_code || "Unknown",
//             error: `Failed to fetch price for product`,
//           });
//         }
//       }

//       // If there are validation errors, return them all at once
//       if (validationErrors.length > 0) {
//         return res.status(400).json({
//           message: `Cannot confirm invoice. The following ${validationErrors.length} products have errors`,
//           errors: validationErrors,
//           errorCount: validationErrors.length,
//         });
//       }

//       req.body.grnDate = date;
//       req.body.grnNumber = await invoiceNumberGenerator("GRN", distributorId);
//     }

//     // Update the invoice only after all validations pass
//     const updatedInvoice = await Invoice.findByIdAndUpdate(inId, req.body, {
//       new: true,
//     });

//     // If the status is "Confirmed", update the Inventory and create Transactions
//     if (
//       updatedInvoice?.status === "Confirmed" &&
//       existingInvoice.status !== "Confirmed"
//     ) {
//       // Loop through line items and update Inventory and Transaction
//       const stockId = await transactionCode("LXSTA");
//       for (const item of updatedInvoice.lineItems) {
//         const { product, receivedQty = 0, damageQty = 0 } = item;

//         // Fetch the product details (already validated above)
//         const productData = await Product.findOne({
//           _id: product,
//         });

//         // Fetch the price (already validated above)
//         const priceResponse = await axios.get(
//           `${SERVER_URL}/api/v1/price/product-pricing/${product._id}?distributorId=${distributorId}`
//         );

//         const priceEntry = priceResponse?.data?.data[0];

//         // Calculate RLP and DLP price per piece or box
//         let rlpbyPcs = 0;
//         let dlpbyPcs = 0;
//         if (productData.uom === "box") {
//           const piecesPerBox = productData.no_of_pieces_in_a_box || 1;
//           rlpbyPcs = priceEntry.rlp_price / piecesPerBox;
//           dlpbyPcs = priceEntry.dlp_price / piecesPerBox;
//         } else {
//           rlpbyPcs = priceEntry.rlp_price || 0;
//           dlpbyPcs = priceEntry.dlp_price || 0;
//         }

//         // Update or create Inventory
//         let inventory = await Inventory.findOne({
//           productId: product,
//           distributorId: updatedInvoice.distributorId,
//           godownType: "main",
//         });

//         if (inventory) {
//           // Update inventory quantity and stock amounts
//           inventory.availableQty += receivedQty;
//           inventory.damagedQty += damageQty;
//           inventory.totalStockamtDlp += dlpbyPcs * receivedQty;
//           inventory.totalStockamtRlp += rlpbyPcs * receivedQty;
//         } else {
//           // Create new inventory entry if not found
//           const inventoryItemId = await generateCode("INVT");
//           inventory = new Inventory({
//             productId: product,
//             distributorId: updatedInvoice.distributorId,
//             invitemId: inventoryItemId,
//             availableQty: receivedQty,
//             damagedQty: damageQty,
//             totalStockamtDlp: dlpbyPcs * receivedQty,
//             totalStockamtRlp: rlpbyPcs * receivedQty,
//             godownType: "main",
//           });
//         }

//         // Save the inventory (either updated or new)
//         await inventory.save();

//         // Create a new Transaction
//         const transaction = new Transaction({
//           distributorId: updatedInvoice.distributorId,
//           productId: product,
//           invItemId: inventory?._id,
//           transactionId: stockId,
//           qty: receivedQty,
//           date: new Date(),
//           type: "In",
//           balanceCount: inventory.availableQty,
//           description: `Invoice ${updatedInvoice.invoiceNo} - Stock received`,
//           transactionType: "invoice",
//           stockType: "salable",
//         });

//         // Save the transaction
//         await transaction.save();
//       }
//     }

//     // **CHANGED: Updated reward points calculation with RBP scheme validation**
//     if (
//       updatedInvoice?.status === "Confirmed" &&
//       existingInvoice.status !== "Confirmed"
//     ) {
//       let rewardPoints = updatedInvoice?.totalBasePoints || 0;
//       const distributorId = updatedInvoice.distributorId;

//       // **NEW: Fetch distributor details to check RBP scheme mapping**
//       const distributor = await Distributor.findById(distributorId).lean();

//       if (!distributor) {
//         console.log(`Distributor not found for ID: ${distributorId}`);
//       } else if (distributor.RBPSchemeMapped !== "yes") {
//         console.log(
//           `Skipping reward points calculation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`
//         );
//       } else {
//         // **EXISTING CODE: Calculate reward points only if RBP scheme is mapped**
//         console.log(
//           `Calculating reward points for distributor ${distributor.dbCode} with RBP scheme mapped`
//         );

//         // for (const item of updatedInvoice.lineItems) {
//         //   const { product, receivedQty = 0 } = item;

//         //   // Fetch the product details
//         //   const productData = await Product.findOne({
//         //     _id: product,
//         //   });

//         //   const base_point = Number(productData?.base_point) || 0;

//         //   if (isNaN(base_point) || base_point <= 0) {
//         //     continue;
//         //   }

//         //   rewardPoints += base_point * receivedQty;
//         // }

//         // **EXISTING CODE: Create distributor transaction only if points > 0**
//         if (rewardPoints > 0) {
//           const LatestTransaction = await DistributorTransaction.findOne({
//             distributorId: distributorId,
//           }).sort({ createdAt: -1 });

//           if (!LatestTransaction) {
//             // create a new transaction
//             const newTransaction = new DistributorTransaction({
//               distributorId: distributorId,
//               transactionType: "credit",
//               transactionFor: "GRN",
//               point: Number(rewardPoints),
//               balance: Number(rewardPoints),
//               invoiceId: updatedInvoice._id,
//               status: "Success",
//               remark: `Reward points for GRN no ${updatedInvoice.grnNumber} with invoice no ${updatedInvoice.invoiceNo} for DB Code ${distributor.dbCode}`, // **UPDATED: Added DB code**
//             });

//             await newTransaction.save();
//             console.log(
//               `Created new distributor transaction with ${rewardPoints} points for distributor ${distributor.dbCode}`
//             );
//           } else {
//             // create a new transaction and update the balance
//             const newTransaction = new DistributorTransaction({
//               distributorId: distributorId,
//               transactionType: "credit",
//               transactionFor: "GRN",
//               point: rewardPoints,
//               balance: Number(LatestTransaction.balance) + Number(rewardPoints),
//               invoiceId: updatedInvoice._id,
//               status: "Success",
//               remark: `Reward points for GRN no ${updatedInvoice.grnNumber} with invoice no ${updatedInvoice.invoiceNo} for DB Code ${distributor.dbCode}`, // **UPDATED: Added DB code**
//             });
//             await newTransaction.save();
//             console.log(
//               `Updated distributor transaction with ${rewardPoints} points for distributor ${distributor.dbCode}`
//             );
//           }
//         }
//       }
//     }
//     return res.status(200).json({
//       status: 200,
//       message: "Invoice detail",
//       data: updatedInvoice,
//     });
//   } catch (error) {
//     res.status(400);
//     throw error;
//   } finally {
//     await releaseLock(lockName);
//   }
// });

// module.exports = { updateInvoice };
