const Transaction = require("../../../models/transaction.model");
const Product = require("../../../models/product.model");
const Distributor = require("../../../models/distributor.model");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const axios = require("axios");
const { SERVER_URL } = require("../../../config/server.config");
const {
  createStockLedgerEntry,
} = require("../../../controllers/transction/createStockLedgerEntry");
/**
 * Adjust a single product line item
 * Creates inventory and transaction records
 *
 * @param {Object} item - Invoice line item
 * @param {Object} invoice - Full invoice document
 * @param {String} distributorId - Distributor ID
 * @param {String} stockId - Stock transaction ID
 * @returns {Object} - { success: true } or { skipped: true }
 */
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

  // Validate product
  const product = await Product.findById(item.product);
  if (!product) {
    throw new Error("Product not found");
  }

  // Validate pricing
  const priceResp = await axios.get(
    `${SERVER_URL}/api/v1/price/product-pricing/${item.product}?distributorId=${distributorId}`,
  );

  if (!priceResp?.data?.data?.length) {
    throw new Error("Price not found");
  }

  // Get or create inventory item
  const Inventory = require("../../../models/inventory.model");
  let inventory = await Inventory.findOne({
    productId: item.product,
    distributorId: distributorId,
    godownType: "main",
  });

  if (!inventory) {
    // Create new inventory if not exists
    const { generateCode } = require("../../../utils/codeGenerator");
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

  // Update inventory quantities
  inventory.availableQty += item.receivedQty;
  await inventory.save();

  // Create transaction with all required fields
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
  });

  await transaction.save();

  try {
    await createStockLedgerEntry(transaction._id);
  } catch (error) {
    console.error(
      `Stock ledger creation failed for transaction ${transaction._id}:`,
      error.message,
    );
    // Don't throw - allow adjustment to continue
  }

  return { success: true };
}

/**
 * Create GRN reward points transaction
 * Only creates if distributor has RBP mapped and all products are adjusted
 *
 * @param {Object} invoice - Invoice document (must be Mongoose document with save())
 */
async function createGRNRewardPoints(invoice) {
  // Already processed successfully
  if (invoice.grnStatus === "success") {
    return;
  }

  // Check distributor RBP mapping
  const distributor = await Distributor.findById(invoice.distributorId).lean();
  if (!distributor || distributor.RBPSchemeMapped !== "yes") {
    invoice.grnStatus = "not-applicable";
    return;
  }

  // Check if all products are adjusted
  const hasPending = invoice.lineItems.some(
    (li) => li.adjustmentStatus !== "success",
  );
  if (hasPending) {
    invoice.grnStatus = "failed";
    invoice.grnError = "Cannot create GRN: Some products are not adjusted";
    return;
  }

  // Check for existing GRN transaction (idempotency)
  const existingGRN = await DistributorTransaction.findOne({
    invoiceId: invoice._id,
    transactionFor: "GRN",
    status: "Success",
  });

  if (existingGRN) {
    invoice.grnStatus = "success";
    return;
  }

  // Calculate total points
  let points = 0;
  for (const li of invoice.lineItems) {
    const product = await Product.findById(li.product).lean();
    const bp = Number(li.usedBasePoint ?? product?.base_point ?? 0);
    if (bp > 0) {
      points += bp * li.receivedQty;
    }
  }

  // No points to credit
  if (points <= 0) {
    invoice.grnStatus = "not-applicable";
    invoice.grnError = "No reward points calculated";
    return;
  }

  try {
    // Get last transaction for balance calculation
    const lastTxn = await DistributorTransaction.findOne({
      distributorId: invoice.distributorId,
    }).sort({ createdAt: -1 });

    const balance = lastTxn ? lastTxn.balance + points : points;

    // Create GRN transaction
    await DistributorTransaction.create({
      distributorId: invoice.distributorId,
      transactionType: "credit",
      transactionFor: "GRN",
      point: points,
      balance,
      invoiceId: invoice._id,
      status: "Success",
      remark: `Reward points for GRN ${invoice.grnNumber} with invoice ${invoice.invoiceNo}`,
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
      `[GRN-ERROR] Invoice ${invoice.invoiceNo} | ${error.message}`,
    );
  }
}

module.exports = {
  adjustSingleProduct,
  createGRNRewardPoints,
};
