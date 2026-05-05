const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

/**
 * 🔥 COMMON GRN GENERATOR (REUSED)
 */
const generateGRNForPO = async ({ purchaseOrder, lineItems }) => {
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
  const failedProducts = [];
  const productSummary = [];

  for (const item of lineItems) {
    // 🔥 find product using productCode
    const product = await Product.findOne({
      productCode: item.productCode,
    });

    if (!product) {
      failedProducts.push(`Invalid Product Code: ${item.productCode}`);
      continue;
    }

    const poItem = purchaseOrder.lineItems.find(
      (p) => String(p.product) === String(product._id)
    );

    if (!poItem) {
      failedProducts.push(`${product.name} (Not in PO)`);
      continue;
    }

    const requestedQty = Number(item.orderQty || 0);
    const alreadyReceived =
      receivedMap[String(product._id)] || 0;

    const remainingQty = poItem.orderQty - alreadyReceived;

    // ❌ validations
    if (remainingQty <= 0 && requestedQty > 0) {
      failedProducts.push(`${product.name} (No qty available)`);
      continue;
    }

    if (requestedQty > remainingQty) {
      failedProducts.push(
        `${product.name} (Only ${remainingQty} qty left)`
      );
      continue;
    }

    if (!requestedQty || requestedQty <= 0) continue;

    // 💰 price
    let priceDoc = await Price.findOne({
      productId: product._id,
      distributorId: purchaseOrder.distributorId,
      status: true,
    }).sort({ createdAt: -1 });

    if (!priceDoc) {
      priceDoc = await Price.findOne({
        productId: product._id,
        price_type: "national",
        status: true,
      }).sort({ createdAt: -1 });
    }

    if (!priceDoc) {
      failedProducts.push(`${product.name} (No price found)`);
      continue;
    }

    const mrp = Number(priceDoc.mrp_price || 0);
    const l1 = Number(item.l1Basic ?? poItem.l1Basic ?? 0);

    let basicRate = mrp;
    if (l1 > 0) {
      basicRate = mrp - (mrp * l1) / 100;
    }

    // 🧾 tax
    let cgstPercent = Number(product?.cgst || 0);
    let sgstPercent = Number(product?.sgst || 0);
    let igstPercent = Number(product?.igst || 0);

    if (!cgstPercent && !sgstPercent && !igstPercent) {
      cgstPercent = 9;
      sgstPercent = 9;
    }

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

    // ➕ totals
    totalGross += grossAmount;
    totalTaxable += taxableAmount;
    totalCGST += cgst;
    totalSGST += sgst;
    totalIGST += igst;
    totalNet += netAmount;

    // 📦 push
    invoiceLineItems.push({
      product: product._id,
      plant: poItem.plant || null,
      goodsType: "billed",
      mrp,
      basicRate,
      qty: requestedQty,
      receivedQty: requestedQty,
      poNumber: purchaseOrder.purchaseOrderNo,
      grossAmount,
      discountAmount: 0,
      specialDiscountAmount: 0,
      taxableAmount,
      cgst,
      sgst,
      igst,
      netAmount,
      usedBasePoint: 0,
      shortageQty: 0,
      damageQty: 0,
      adjustmentStatus: "success",
    });

    productSummary.push({
      name: product.name,
      qty: requestedQty,
    });
  }

  if (!invoiceLineItems.length) {
    throw new Error(
      failedProducts.length
        ? failedProducts.join(", ")
        : "No valid quantity provided"
    );
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

  // 🔥 update PO status
  const allInvoices = await Invoice.find({
    purchaseOrderId: purchaseOrder._id,
  });

  const totalReceivedMap = {};
  for (const inv of allInvoices) {
    for (const li of inv.lineItems) {
      const key = String(li.product);
      totalReceivedMap[key] =
        (totalReceivedMap[key] || 0) + Number(li.qty || 0);
    }
  }

  let isComplete = true;
  let isPartial = false;

  for (const poItem of purchaseOrder.lineItems) {
    const received = totalReceivedMap[String(poItem.product)] || 0;

    if (received === 0) {
      isComplete = false;
    } else if (received < poItem.orderQty) {
      isComplete = false;
      isPartial = true;
    } else {
      isPartial = true;
    }
  }

  let poInvoiceStatus = "Pending";

  if (isComplete) poInvoiceStatus = "Complete-Invoiced";
  else if (isPartial) poInvoiceStatus = "Partially-Invoiced";

  await PurchaseOrder.findByIdAndUpdate(
    purchaseOrder._id,
    { $set: { invoicestatus: poInvoiceStatus } }
  );

  return {
    message: `GRN created for ${productSummary.length} items`,
    data: invoice,
    failedProducts,
  };
};

/**
 * 🚀 BULK GRN IMPORT (CSV BASED)
 */
const importGrnforPoOrder = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "No data provided",
      });
    }

    // 🔥 group by PO Number
    const grouped = {};

    for (const row of rows) {
      const poNumber = row["PO Number"];
      const productCode = row["Product Code"];

      if (!poNumber || !productCode) continue;

      if (!grouped[poNumber]) {
        grouped[poNumber] = [];
      }

      grouped[poNumber].push({
        productCode,
        orderQty: Number(row["SO Qty (PCS)"] || 0),
        l1Basic: Number(row["L1 Basic"] || 0),
      });
    }

    const results = [];
    const errors = [];

    // 🔁 process each PO
    for (const poNumber of Object.keys(grouped)) {
      try {
        const purchaseOrder = await PurchaseOrder.findOne({
          purchaseOrderNo: poNumber,
        });

        if (!purchaseOrder) {
          throw new Error("Purchase Order not found");
        }

        const result = await generateGRNForPO({
          purchaseOrder,
          lineItems: grouped[poNumber],
        });

        results.push({
          purchaseOrderNo: poNumber,
          message: result.message,
          failedProducts: result.failedProducts,
        });
      } catch (err) {
        errors.push({
          purchaseOrderNo: poNumber,
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