const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");
const Inventory = require("../../models/inventory.model");
const axios = require("axios");
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";

const confirmGRNAndGenerateInvoice = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    const {
      lineItems = [],
      invoiceNo,
      invoiceDate,
      grnDate,
      vehicleNumber,
      foreclose,
    } = req.body;

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

    if (!purchaseOrder) {
      return res.status(404).json({
        message: "Purchase Order not found",
      });
    }

    if (!purchaseOrder.godownId) {
      return res.status(400).json({
        message: "Purchase Order has no Godown assigned. Cannot proceed with GRN.",
      });
    }

    if (foreclose === true) {
      const {
        productIds = [],
        forecloseReason = "",
        forecloseUom = [],
      } = req.body;

      console.log("🔍 Foreclose Request:", {
        productIds,
        forecloseReason,
        forecloseUom,
      });

      if (!productIds.length) {
        return res.status(400).json({
          message: "No products selected",
        });
      }

      for (const item of purchaseOrder.lineItems) {
        const currentProductId = String(item.product);

        if (productIds.includes(currentProductId)) {
          const matchedQty = forecloseUom.find(
            (q) => String(q.productId) === currentProductId
          );

          const shortCloseQty = Number(matchedQty?.forecloseUom || 0);

          item.foreclose = true;
          item.forecloseReason = forecloseReason;
          item.forecloseUom = shortCloseQty;

          // Fetch product to get conversion factor
          const product = await Product.findById(item.product);

          const pcsPerUom = Number(product?.no_of_pieces_in_a_box || 1);

          // Convert UOM to Pieces
          const shortClosePcs = shortCloseQty * pcsPerUom;

          // Reduce In-Transit Qty in Pieces
          await Inventory.findOneAndUpdate(
            {
              distributorId: purchaseOrder.distributorId,
              productId: item.product,
              godownId: purchaseOrder.godownId,
            },
            {
              $inc: {
                intransitQty: -shortClosePcs,
              },
            }
          );
        }
      }

      await purchaseOrder.save();

      return res.status(200).json({
        message: "Products Shortclosed Successfully",
        data: purchaseOrder,
      });
    }

    // =========================
    // 🔥 VALIDATE invoiceNo EARLY (before any heavy work)
    // =========================
    // Frontend payload sends invoiceNo like "INVabc11" - can be alphanumeric,
    // not strictly numeric, so we just check for exact duplicates.
    let finalInvoiceNo =
      typeof invoiceNo === "string" ? invoiceNo.trim() : invoiceNo;

    if (finalInvoiceNo) {
      const existingInvoiceNo = await Invoice.findOne({
        invoiceNo: finalInvoiceNo,
      }).lean();

      if (existingInvoiceNo) {
        return res.status(409).json({
          message: `Invoice number "${finalInvoiceNo}" already exists. Please use a different invoice number.`,
        });
      }
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
        receivedMap[key] = (receivedMap[key] || 0) + Number(li.qty || 0);
      }
    }

    // =========================
    // 🔢 GENERATE GRN NUMBER (with uniqueness check)
    // =========================

    // Get current year (last 2 digits)
    const year = new Date().getFullYear().toString().slice(-2);

    // Find last GRN of this year
    const lastGrnInvoice = await Invoice.findOne({
      grnNumber: { $regex: `^GRN-${year}` },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Default sequence
    let grnSequence = 1;

    if (lastGrnInvoice?.grnNumber) {
      const lastNumber = lastGrnInvoice.grnNumber.split("-")[1]; // "2600007"
      const lastSeq = Number(lastNumber?.slice(2)); // remove "26"
      grnSequence = Number.isFinite(lastSeq) && lastSeq > 0 ? lastSeq + 1 : 1;
    }

    // Pad sequence → 00001
    let paddedSeq = String(grnSequence).padStart(5, "0");

    // Final GRN
    let grnNumber = `GRN-${year}${paddedSeq}`;

    // ✅ Ensure GRN number is unique (guards against gaps / concurrent requests)
    while (await Invoice.exists({ grnNumber })) {
      grnSequence += 1;
      paddedSeq = String(grnSequence).padStart(5, "0");
      grnNumber = `GRN-${year}${paddedSeq}`;
    }

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

      const alreadyReceived = receivedMap[String(item.productId)] || 0;

      // ✅ Case 3: ignore zero qty (important)
      if (!requestedQty || requestedQty <= 0) {
        zeroQtyProducts.push(productName);
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
        failedProducts.push(`${productName} (no price found)`);
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
        soNumber: poItem.soNumber || "",
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
      const currentReceived = invoiceLineItems
        .filter((li) => String(li.product) === String(poItem.product))
        .reduce((sum, li) => sum + (li.qty || 0), 0);

      return currentReceived >= poItem.orderQty;
    });

    if (isSingleInvoiceComplete) {
      invoicetype = "Complete-Invoiced";
    }

    // =========================
    // 🔢 GENERATE INVOICE NUMBER (only if frontend didn't send one)
    // =========================
    // NOTE: duplicate check for a frontend-supplied invoiceNo already
    // happened at the top of this function, right after we found the PO.
    if (!finalInvoiceNo) {
      const lastInvoiceDoc = await Invoice.findOne({})
        .sort({ createdAt: -1 })
        .lean();

      let nextSequence = 1;

      if (lastInvoiceDoc?.invoiceNo) {
        // Extract number from INV000001
        const numericPart = lastInvoiceDoc.invoiceNo.replace(/\D/g, "");

        if (numericPart) {
          nextSequence = Number(numericPart) + 1;
        }
      }

      // Generate sequential invoice number
      finalInvoiceNo = `INV${String(nextSequence).padStart(6, "0")}`;

      // ✅ Ensure uniqueness even if there are gaps or manually inserted
      // invoiceNos (e.g. "INVabc11", "INV010101")
      while (await Invoice.exists({ invoiceNo: finalInvoiceNo })) {
        nextSequence += 1;
        finalInvoiceNo = `INV${String(nextSequence).padStart(6, "0")}`;
      }
    }

    // =========================
    // 🧾 CREATE INVOICE
    // =========================
    let invoice;

    try {
      invoice = await Invoice.create({
        distributorId: purchaseOrder.distributorId,
        godownId: purchaseOrder.godownId,
        invoiceNo: finalInvoiceNo,
        date: invoiceDate ? new Date(invoiceDate) : new Date(),
        status: "In-Transit",
        purchaseOrderId: purchaseOrder._id,
        soNumber: purchaseOrder.soNumber || "",
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        grnDate: grnDate
          ? new Date(`${grnDate}T00:00:00.000Z`)
          : new Date(),
        grnNumber,
        lineItems: invoiceLineItems,
        vehicleNumber: vehicleNumber || "",
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
    } catch (err) {
      // ✅ Handles the race-condition case: two requests passing the
      // pre-checks above at (almost) the same time. Requires unique
      // indexes on invoiceNo and grnNumber in invoice.model.js - see notes.
      if (err.code === 11000) {
        const dupField = Object.keys(err.keyPattern || {})[0];

        if (dupField === "invoiceNo") {
          return res.status(409).json({
            message: `Invoice number "${finalInvoiceNo}" was just used by another request. Please retry.`,
          });
        }

        if (dupField === "grnNumber") {
          return res.status(409).json({
            message: `GRN number "${grnNumber}" was just used by another request. Please retry.`,
          });
        }

        return res.status(409).json({
          message: "Duplicate invoice/GRN number detected. Please retry.",
        });
      }

      throw err;
    }

    // Reduce In-Transit Qty after GRN
    for (const item of invoiceLineItems) {
      await Inventory.findOneAndUpdate(
        {
          distributorId: purchaseOrder.distributorId,
          productId: item.product,
          godownId: purchaseOrder.godownId,
        },
        {
          $inc: {
            intransitQty: -Number(item.receivedQty || item.qty || 0),
          },
        },
        {
          new: true,
        }
      );
    }

    // =========================
    // 🔥 UPDATE PURCHASE ORDER INVOICE STATUS (ONLY THIS CHANGE)
    // =========================
    await PurchaseOrder.findByIdAndUpdate(purchaseOrder._id, {
      $push: { invoiceIds: invoice._id },
    });

    console.log("🚀 AUTO CALLING INVOICE UPDATE API");
    console.log("TOKEN:", req.headers.authorization);

    try {
      const updateResponse = await axios.patch(
        `${SERVER_URL}/api/v1/invoice/update-invoice-internal/${invoice._id}`,
        {
          status: "Confirmed",
          grnDate: invoice.grnDate,
        }
      );

      console.log("✅ AUTO INVOICE UPDATED");
      console.log(updateResponse.data);
    } catch (autoError) {
      console.log("❌ AUTO UPDATE FAILED");
      console.log(autoError?.response?.data || autoError.message);
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
    await PurchaseOrder.findByIdAndUpdate(purchaseOrder._id, {
      $set: { invoicestatus: poInvoiceStatus },
    });

    // =========================
    // 🧾 FINAL MESSAGE
    // =========================
    let finalMessage = "";

    if (productSummary.length) {
      const successMsg = productSummary
        .map((p) => `${p.name} (${p.qty})`)
        .join(", ");

      const label =
        invoicetype === "Complete-Invoiced"
          ? "✅ GRN created for:"
          : "⚠️ Partial GRN created for:";

      finalMessage += `${label} ${successMsg}`;
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