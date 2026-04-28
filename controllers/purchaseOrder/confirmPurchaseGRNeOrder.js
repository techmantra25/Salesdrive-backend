const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

const confirmGRNAndGenerateInvoice = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;
    const { lineItems = [] } = req.body;

    console.log("📥 GRN Request:", lineItems);

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    // =========================
    // 🔥 FETCH PREVIOUS INVOICES
    // =========================
    const invoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    });

    // =========================
    // 🔥 BUILD RECEIVED MAP
    // =========================
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

    // ✅ NEW ARRAYS
    const failedProducts = [];
    const completedProducts = [];

    // =========================
    // 🔁 PROCESS LINE ITEMS
    // =========================
    for (const item of lineItems) {
      const poItem = purchaseOrder.lineItems.find(
        (p) => String(p.product) === String(item.productId)
      );

      if (!poItem) {
        console.log("⚠️ Not in PO:", item.productId);
        continue;
      }

      // ✅ FETCH PRODUCT
      const product = await Product.findById(item.productId);
      const productName =
        product?.name || product?.productName || "Unknown Product";

      const requestedQty = Number(item.orderQty || 0);
      if (!requestedQty || requestedQty <= 0) continue;

      const alreadyReceived =
        receivedMap[String(item.productId)] || 0;

      const remainingQty = poItem.orderQty - alreadyReceived;

      // ⏭ Already completed
      if (remainingQty <= 0) {
        console.log("⏭ Already completed:", productName);

        completedProducts.push(
          `${productName} (Already completed)`
        );

        continue;
      }

      // ❌ Over quantity (DO NOT RETURN)
      if (requestedQty > remainingQty) {
        failedProducts.push(
          `${productName} (Only ${remainingQty} qty left)`
        );
        continue;
      }

      // =========================
      // 💰 FETCH PRICE
      // =========================
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

      if (!priceDoc) {
        console.log("⚠️ No price:", item.productId);
        continue;
      }

      const mrp = Number(priceDoc.mrp_price || 0);

      // =========================
      // 🎯 L1 DISCOUNT
      // =========================
      const l1 = Number(item.l1Basic ?? poItem.l1Basic ?? 0);

      let basicRate = mrp;
      if (l1 > 0) {
        basicRate = mrp - (mrp * l1) / 100;
      }

      if (!basicRate || basicRate < 0) {
        basicRate = mrp;
      }

      // =========================
      // 🧾 TAX
      // =========================
      let cgstPercent = Number(product?.cgst || 0);
      let sgstPercent = Number(product?.sgst || 0);
      let igstPercent = Number(product?.igst || 0);

      if (!cgstPercent && !sgstPercent && !igstPercent) {
        cgstPercent = 9;
        sgstPercent = 9;
      }

      // =========================
      // 🧮 CALCULATIONS
      // =========================
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

      // =========================
      // ➕ TOTALS
      // =========================
      totalGross += grossAmount;
      totalTaxable += taxableAmount;
      totalCGST += cgst;
      totalSGST += sgst;
      totalIGST += igst;
      totalNet += netAmount;

      // =========================
      // 📦 PUSH LINE ITEM
      // =========================
      invoiceLineItems.push({
        product: item.productId,
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
        shortageUom: "pcs",
        damageQty: 0,
        damageUom: "pcs",
        adjustmentStatus: "success",
      });

      productSummary.push({
        name: productName,
        qty: requestedQty,
      });
    }

    // ❌ If nothing valid
    if (!invoiceLineItems.length) {
      return res.status(400).json({
        message: "No remaining qty available for GRN",
      });
    }

    // =========================
    // 🧾 CREATE INVOICE
    // =========================
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
      GRNFKDATE: new Date(),
      grnStatus: "success",
      adjustmentSummary: {
        totalProducts: invoiceLineItems.length,
        successfulAdjustments: invoiceLineItems.length,
        failedAdjustments: 0,
        lastRetryAttempt: new Date(),
      },
    });

    // =========================
    // 🧾 FINAL MESSAGE
    // =========================
    let finalMessage = "";

    if (productSummary.length) {
      const successMsg = productSummary
        .map((p) => `${p.name} (${p.qty})`)
        .join(", ");

      finalMessage += `⚠️ Partial GRN created for: ${successMsg}`;
    }

    if (failedProducts.length) {
      finalMessage += ` | ❌ Failed: ${failedProducts.join(", ")}`;
    }

    if (completedProducts.length) {
      finalMessage += ` | ⏭ Skipped: ${completedProducts.join(", ")}`;
    }

    return res.status(200).json({
      message: finalMessage,
      data: invoice,
    });
  } catch (error) {
    console.error("❌ GRN ERROR:", error);

    return res.status(400).json({
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = {
  confirmPurchaseGRNeOrder: confirmGRNAndGenerateInvoice,
};