const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");
const axios = require("axios");
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";

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
    // =========================
    // 🔢 GENERATE GRN NUMBER
    // =========================

    // Get current year (last 2 digits)
    const year = new Date().getFullYear().toString().slice(-2);

    // Find last GRN of this year
    const lastInvoice = await Invoice.findOne({
      grnNumber: { $regex: `^GRN-${year}` },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Default sequence
    let nextSequence = 1;

    if (lastInvoice?.grnNumber) {
      const lastNumber = lastInvoice.grnNumber.split("-")[1]; // "2600001"
      const lastSeq = Number(lastNumber.slice(2)); // remove "26"
      nextSequence = lastSeq + 1;
    }

    // Pad sequence → 00001
    const paddedSeq = String(nextSequence).padStart(5, "0");

    // Final GRN
    const grnNumber = `GRN-${year}${paddedSeq}`;

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
    const zeroQtyProducts = [];
    let hasValidationError = false;
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

      const alreadyReceived =
        receivedMap[String(item.productId)] || 0;

      const remainingQty = poItem.orderQty - alreadyReceived;

      // ❌ Case 1: user entered qty but nothing available
      if (remainingQty <= 0 && requestedQty > 0) {
        failedProducts.push(
          `${productName} (No qty available)`
        );
        hasValidationError = true;
        continue;
      }

      // ❌ Case 2: user exceeded remaining qty
      if (requestedQty > remainingQty) {
        failedProducts.push(
          `${productName} (Only ${remainingQty} qty left)`
        );
        hasValidationError = true;
        continue;
      }

      // ✅ Case 3: ignore zero qty (important)
      if (!requestedQty || requestedQty <= 0) {
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
        adjustmentStatus: "pending",
      });

      productSummary.push({
        name: productName,
        qty: requestedQty,
      });
    }
    // ❌ STRICT OVER-QTY VALIDATION (NEW)


    if (hasValidationError) {
      return res.status(400).json({
        message: `Invoice failed. Issues: ${failedProducts.join(", ")}`,
      });
    }
    if (!invoiceLineItems.length) {
      let message = "Cannot create invoice.";

      if (failedProducts.length) {
        message += ` Exceeded qty: ${failedProducts.join(", ")}`;
      } else {
        message += ` No valid quantity provided.`;
      }

      if (completedProducts.length) {
        message += ` | Already completed: ${completedProducts.join(", ")}`;
      }

      return res.status(400).json({ message });
    }

    // =========================
    // 🏷️ DETERMINE INVOICE TYPE
    // =========================
    let invoicetype = "Partially-Invoiced";

    const isSingleInvoiceComplete = purchaseOrder.lineItems.every((poItem) => {
      const currentReceived =
        invoiceLineItems
          .filter(
            (li) =>
              String(li.product) === String(poItem.product)
          )
          .reduce((sum, li) => sum + (li.qty || 0), 0);

      return currentReceived >= poItem.orderQty;
    });

    if (isSingleInvoiceComplete) {
      invoicetype = "Complete-Invoiced";
    } // =========================
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
      invoicetype,
      adjustmentSummary: {
        totalProducts: invoiceLineItems.length,
        successfulAdjustments: invoiceLineItems.length,
        failedAdjustments: 0,
        lastRetryAttempt: new Date(),
      },
    });
    // =========================
    // 🔥 UPDATE PURCHASE ORDER INVOICE STATUS (ONLY THIS CHANGE)
    // =========================
await PurchaseOrder.findByIdAndUpdate(
  purchaseOrder._id,
  {
    $push: { invoiceIds: invoice._id }
  }
);




console.log("🚀 AUTO CALLING INVOICE UPDATE API");

console.log("TOKEN:", req.headers.authorization);

try {

const updateResponse = await axios.patch(
  `${SERVER_URL}/api/v1/invoice/update-invoice/${invoice._id}`,
  {
    status: "Confirmed",
  },
);

  console.log("✅ AUTO INVOICE UPDATED");

  console.log(updateResponse.data);

} catch (autoError) {

  console.log("❌ AUTO UPDATE FAILED");

  console.log(
    autoError?.response?.data || autoError.message
  );

}










    // Fetch all invoices again (including current one)
    const allInvoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    });

    // Build total received qty map
    const totalReceivedMap = {};

    for (const inv of allInvoices) {
      for (const li of inv.lineItems) {
        const key = String(li.product);
        totalReceivedMap[key] =
          (totalReceivedMap[key] || 0) + Number(li.qty || 0);
      }
    }

    // Decide PO status
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

    if (isComplete) {
      poInvoiceStatus = "Complete-Invoiced";
    } else if (isPartial) {
      poInvoiceStatus = "Partially-Invoiced";
    }

    // Update ONLY invoicestatus
    await PurchaseOrder.findByIdAndUpdate(
      purchaseOrder._id,
      { $set: { invoicestatus: poInvoiceStatus } }
    );

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

    if (zeroQtyProducts.length) {
      finalMessage += ` | ⚠️ Zero qty: ${zeroQtyProducts.join(", ")}`;
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