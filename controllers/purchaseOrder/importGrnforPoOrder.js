const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

/**
 * 🔥 Reusable single GRN processor (same as your existing logic)
 */
const processSingleGRN = async ({ purchaseOrderId, lineItems }) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);
  console.log("Processing PO:", purchaseOrderId, "with items:", lineItems);

  if (!purchaseOrder) {
    throw new Error("Purchase Order not found");
  }

  const invoices = await Invoice.find({
    purchaseOrderId: purchaseOrder._id,
  });

  const receivedMap = {};
  for (const inv of invoices) {
    for (const li of inv.lineItems) {
      const key = String(li.product);
      receivedMap[key] =
        (receivedMap[key] || 0) + Number(li.qty || 0);
    }
  }

  const grnNumber = `GRN-${Date.now()}`;

  let totalGross = 0;
  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;
  let totalNet = 0;

  const invoiceLineItems = [];
  const productSummary = [];
  const failedProducts = [];

  let hasValidationError = false;

  for (const item of lineItems) {
    const poItem = purchaseOrder.lineItems.find(
      (p) => String(p.product) === String(item.productId)
    );

    if (!poItem) continue;

    const product = await Product.findById(item.productId);
    const productName =
      product?.name || product?.productName || "Unknown Product";

    const requestedQty = Number(item.orderQty || 0);
    const alreadyReceived =
      receivedMap[String(item.productId)] || 0;

    const remainingQty = poItem.orderQty - alreadyReceived;

    // ❌ validation same as single
    if (remainingQty <= 0 && requestedQty > 0) {
      failedProducts.push(`${productName} (No qty available)`);
      hasValidationError = true;
      continue;
    }

    if (requestedQty > remainingQty) {
      failedProducts.push(
        `${productName} (Only ${remainingQty} qty left)`
      );
      hasValidationError = true;
      continue;
    }

    if (!requestedQty || requestedQty <= 0) continue;

    // 💰 price
    let priceDoc = await Price.findOne({
      productId: item.productId,
      distributorId: purchaseOrder.distributorId,
      status: true,
    }).sort({ createdAt: -1 });

    if (!priceDoc) {
      priceDoc = await Price.findOne({
        productId: item.productId,
        price_type: "national",
        status: true,
      }).sort({ createdAt: -1 });
    }

    if (!priceDoc) continue;

    const mrp = Number(priceDoc.mrp_price || 0);
    const l1 = Number(item.l1Basic ?? poItem.l1Basic ?? 0);

    let basicRate = mrp;
    if (l1 > 0) {
      basicRate = mrp - (mrp * l1) / 100;
    }

    const cgstPercent = Number(product?.cgst || 9);
    const sgstPercent = Number(product?.sgst || 9);
    const igstPercent = Number(product?.igst || 0);

    const grossAmount = basicRate * requestedQty;
    const taxableAmount = grossAmount;

    let cgst = 0,
      sgst = 0,
      igst = 0;

    if (igstPercent > 0) {
      igst = (grossAmount * igstPercent) / 100;
    } else {
      cgst = (grossAmount * cgstPercent) / 100;
      sgst = (grossAmount * sgstPercent) / 100;
    }

    const netAmount = grossAmount + cgst + sgst + igst;

    totalGross += grossAmount;
    totalTaxable += taxableAmount;
    totalCGST += cgst;
    totalSGST += sgst;
    totalIGST += igst;
    totalNet += netAmount;

    invoiceLineItems.push({
      product: item.productId,
      goodsType: "billed",
      mrp,
      basicRate,
      qty: requestedQty,
      receivedQty: requestedQty,
      poNumber: purchaseOrder.purchaseOrderNo,
      grossAmount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      netAmount,
      adjustmentStatus: "success",
    });

    productSummary.push({
      name: productName,
      qty: requestedQty,
    });
  }

  if (hasValidationError) {
    throw new Error(`Issues: ${failedProducts.join(", ")}`);
  }

  if (!invoiceLineItems.length) {
    throw new Error("No valid quantity provided");
  }

  // 🧾 create invoice
  const invoice = await Invoice.create({
    distributorId: purchaseOrder.distributorId,
    invoiceNo: `INV-${Date.now()}`,
    date: new Date(),
    status: "In-Transit",
    purchaseOrderId: purchaseOrder._id,
    grnDate: new Date(),
    grnNumber,
    lineItems: invoiceLineItems,
    grossAmount: totalGross,
    taxableAmount: totalTaxable,
    cgst: totalCGST,
    sgst: totalSGST,
    igst: totalIGST,
    invoiceAmount: totalNet,
    totalInvoiceAmount: totalNet,
    grnStatus: "success",
  });

  return {
    message: `GRN created for ${productSummary.length} items`,
    data: invoice,
  };
};

/**
 * 🚀 MAIN CONTROLLER: BULK GRN IMPORT
 */
const importGrnforPoOrder = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;
console.log("Received bulk GRN data:", rows);
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "No data provided",
      });
    }

    // 🔥 group by PO
    const grouped = {};

    for (const row of rows) {
      const poId = row.purchaseOrderId;

      if (!poId || !row.productId) continue;

      if (!grouped[poId]) {
        grouped[poId] = [];
      }

      grouped[poId].push({
        productId: row.productId,
        orderQty: Number(row.orderQty || 0),
        l1Basic: Number(row.l1Basic || 0),
      });
    }

    const results = [];
    const errors = [];

    // 🔁 process each PO
    for (const poId of Object.keys(grouped)) {
      try {
        const result = await processSingleGRN({
          purchaseOrderId: poId,
          lineItems: grouped[poId],
        });

        results.push({
          purchaseOrderId: poId,
          message: result.message,
        });
      } catch (err) {
        errors.push({
          purchaseOrderId: poId,
          message: err.message,
        });
      }
    }

    return res.status(200).json({
      message: "Bulk GRN processed",
      successCount: results.length,
      failedCount: errors.length,
      results,
      errors,
    });

  } catch (error) {
    console.error("❌ BULK GRN ERROR:", error);

    return res.status(500).json({
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = {
  importGrnforPoOrder,
};