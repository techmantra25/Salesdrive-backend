const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");
const Inventory = require("../../models/inventory.model");
const axios = require("axios");
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";

// =========================
// 📦 IN-TRANSIT HELPERS
// =========================

// Read-only check: is there enough in-transit qty to deduct?
const getIntransitAvailable = async (filter) => {
  const inv = await Inventory.findOne(filter).select("intransitQty").lean();
  return inv ? Number(inv.intransitQty || 0) : null; // null = no inventory doc
};

// Atomic deduct: only succeeds if intransitQty >= qty. Returns null if it fails.
const deductIntransit = (filter, qty) =>
  Inventory.findOneAndUpdate(
    { ...filter, intransitQty: { $gte: qty } },
    { $inc: { intransitQty: -qty } },
    { new: true }
  );

// Used for rollback
const addBackIntransit = (filter, qty) =>
  Inventory.findOneAndUpdate(
    filter,
    { $inc: { intransitQty: qty } },
    { new: true }
  );

// Validate a list of { filter, qty, name } BEFORE touching anything.
// Returns an array of error strings (empty = all good).
const validateIntransit = async (entries) => {
  // merge duplicate products so totals are checked correctly
  const merged = new Map();
  for (const e of entries) {
    const key = JSON.stringify(e.filter);
    if (merged.has(key)) {
      merged.get(key).qty += e.qty;
    } else {
      merged.set(key, { ...e });
    }
  }

  const errors = [];
  for (const e of merged.values()) {
    if (e.qty <= 0) continue;
    const available = await getIntransitAvailable(e.filter);

    if (available === null) {
      errors.push(`${e.name}: inventory record not found`);
    } else if (available < e.qty) {
      errors.push(
        `${e.name}: insufficient in-transit qty (available ${available}, required ${e.qty})`
      );
    }
  }
  return errors;
};

// Deduct all entries; if any fails (e.g. race condition), roll back the ones done.
// Returns { ok: true } or { ok: false, message }
const deductAllOrRollback = async (entries) => {
  const done = [];

  for (const e of entries) {
    if (e.qty <= 0) continue;

    const updated = await deductIntransit(e.filter, e.qty);

    if (!updated) {
      for (const d of done) {
        await addBackIntransit(d.filter, d.qty);
      }
      return {
        ok: false,
        message: `${e.name}: insufficient in-transit qty to deduct ${e.qty}`,
      };
    }

    done.push(e);
  }

  return { ok: true };
};

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

    // =========================
    // ✂️ FORECLOSE (SHORT CLOSE)
    // =========================
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

      // Step 1: build the list of changes (no DB writes yet)
      const forecloseEntries = [];
      const itemsToUpdate = [];

      for (const item of purchaseOrder.lineItems) {
        const currentProductId = String(item.product);

        if (!productIds.includes(currentProductId)) continue;

        // already foreclosed -> skip so it can't be deducted twice
        if (item.foreclose) continue;

        const matchedQty = forecloseUom.find(
          (q) => String(q.productId) === currentProductId
        );

        const shortCloseQty = Number(matchedQty?.forecloseUom || 0);

        const product = await Product.findById(item.product);
        const pcsPerUom = Number(product?.no_of_pieces_in_a_box || 1);

        // Convert UOM to Pieces
        const shortClosePcs = shortCloseQty * pcsPerUom;

        forecloseEntries.push({
          name: product?.name || product?.productName || String(item.product),
          qty: shortClosePcs,
          filter: {
            distributorId: purchaseOrder.distributorId,
            productId: item.product,
            godownId: purchaseOrder.godownId,
          },
        });

        itemsToUpdate.push({ item, shortCloseQty });
      }

      if (!itemsToUpdate.length) {
        return res.status(400).json({
          message: "Selected products are already foreclosed or not in this PO",
        });
      }

      // Step 2: validate in-transit BEFORE changing anything
      const forecloseErrors = await validateIntransit(forecloseEntries);

      if (forecloseErrors.length) {
        return res.status(400).json({
          message: `Foreclose failed. ${forecloseErrors.join(" | ")}`,
        });
      }

      // Step 3: deduct atomically (rolls back if anything fails)
      const result = await deductAllOrRollback(forecloseEntries);

      if (!result.ok) {
        return res.status(400).json({
          message: `Foreclose failed. ${result.message}`,
        });
      }

      // Step 4: update PO items and save
      for (const { item, shortCloseQty } of itemsToUpdate) {
        item.foreclose = true;
        item.forecloseReason = forecloseReason;
        item.forecloseUom = shortCloseQty;
      }

      try {
        await purchaseOrder.save();
      } catch (saveErr) {
        // save failed -> put in-transit back
        for (const e of forecloseEntries) {
          if (e.qty > 0) await addBackIntransit(e.filter, e.qty);
        }
        throw saveErr;
      }

      return res.status(200).json({
        message: "Products Shortclosed Successfully",
        data: purchaseOrder,
      });
    }

    // =========================
    // 🔥 VALIDATE invoiceNo EARLY (before any heavy work)
    // =========================
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
    const year = new Date().getFullYear().toString().slice(-2);

    const lastGrnInvoice = await Invoice.findOne({
      grnNumber: { $regex: `^GRN-${year}` },
    })
      .sort({ createdAt: -1 })
      .lean();

    let grnSequence = 1;

    if (lastGrnInvoice?.grnNumber) {
      const lastNumber = lastGrnInvoice.grnNumber.split("-")[1]; // "2600007"
      const lastSeq = Number(lastNumber?.slice(2)); // remove "26"
      grnSequence = Number.isFinite(lastSeq) && lastSeq > 0 ? lastSeq + 1 : 1;
    }

    let paddedSeq = String(grnSequence).padStart(5, "0");
    let grnNumber = `GRN-${year}${paddedSeq}`;

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

    const failedProducts = [];
    const completedProducts = [];
    const zeroQtyProducts = [];
    let hasValidationError = false;

    // =========================
    // 🔁 PROCESS LINE ITEMS
    // =========================
    const resolvedSoNumbers = new Set();

    for (const item of lineItems) {
      const poItem = purchaseOrder.lineItems.find(
        (p) => String(p.product) === String(item.productId)
      );

      if (!poItem) {
        console.log("⚠️ Not in PO:", item.productId);
        continue;
      }

      if (poItem.soNumber) {
        resolvedSoNumbers.add(String(poItem.soNumber).trim());
      }

      const product = await Product.findById(item.productId);
      const productName =
        product?.name || product?.productName || "Unknown Product";

      const requestedQty = Number(item.orderQty || 0);

      const alreadyReceived = receivedMap[String(item.productId)] || 0;

      // ignore zero qty
      if (!requestedQty || requestedQty <= 0) {
        zeroQtyProducts.push(productName);
        continue;
      }

      // ❌ Over-receipt check
      const remainingQty = Number(poItem.orderQty || 0) - alreadyReceived;

      if (requestedQty > remainingQty) {
        failedProducts.push(
          `${productName} (exceeds pending qty: ${Math.max(remainingQty, 0)})`
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
        productName, // used only for error messages, stripped before save
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

    if (hasValidationError) {
      return res.status(400).json({
        message: `Invoice failed. Issues: ${failedProducts.join(", ")}`,
      });
    }

    if (!invoiceLineItems.length) {
      let message = "Cannot create invoice.";

      if (failedProducts.length) {
        message += ` Issues: ${failedProducts.join(", ")}`;
      } else {
        message += ` No valid quantity provided.`;
      }

      if (completedProducts.length) {
        message += ` | Already completed: ${completedProducts.join(", ")}`;
      }

      return res.status(400).json({ message });
    }

    // =========================
    // 🛑 CHECK IN-TRANSIT BEFORE CREATING INVOICE
    // =========================
    const grnEntries = invoiceLineItems.map((li) => ({
      name: li.productName,
      qty: Number(li.receivedQty || li.qty || 0),
      filter: {
        distributorId: purchaseOrder.distributorId,
        productId: li.product,
        godownId: purchaseOrder.godownId,
      },
    }));

    const intransitErrors = await validateIntransit(grnEntries);

    if (intransitErrors.length) {
      return res.status(400).json({
        message: `GRN failed. ${intransitErrors.join(" | ")}`,
      });
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
    if (!finalInvoiceNo) {
      const lastInvoiceDoc = await Invoice.findOne({})
        .sort({ createdAt: -1 })
        .lean();

      let nextSequence = 1;

      if (lastInvoiceDoc?.invoiceNo) {
        const numericPart = lastInvoiceDoc.invoiceNo.replace(/\D/g, "");

        if (numericPart) {
          nextSequence = Number(numericPart) + 1;
        }
      }

      finalInvoiceNo = `INV${String(nextSequence).padStart(6, "0")}`;

      while (await Invoice.exists({ invoiceNo: finalInvoiceNo })) {
        nextSequence += 1;
        finalInvoiceNo = `INV${String(nextSequence).padStart(6, "0")}`;
      }
    }

    const roundedInvoiceAmount = Math.round(totalNet);
    const roundOff = roundedInvoiceAmount - totalNet;

    // strip helper-only field before saving
    const invoiceLineItemsToSave = invoiceLineItems.map(
      ({ productName, ...rest }) => rest
    );

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
        soNumber: Array.from(resolvedSoNumbers).join(", "),
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        grnDate: grnDate
          ? new Date(`${grnDate}T00:00:00.000Z`)
          : new Date(),
        grnNumber,
        lineItems: invoiceLineItemsToSave,
        vehicleNumber: vehicleNumber || "",
        grossAmount: totalGross,
        taxableAmount: totalTaxable,
        cgst: totalCGST,
        sgst: totalSGST,
        igst: totalIGST,
        invoiceAmount: totalNet,
        roundOff,
        totalInvoiceAmount: roundedInvoiceAmount,
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

    // =========================
    // 📉 REDUCE IN-TRANSIT (atomic, never goes below 0)
    // =========================
    const deductResult = await deductAllOrRollback(grnEntries);

    if (!deductResult.ok) {
      // Another request used up the stock between our check and now.
      // Remove the invoice we just created so nothing is left half-done.
      await Invoice.findByIdAndDelete(invoice._id);

      return res.status(400).json({
        message: `GRN failed. ${deductResult.message}`,
      });
    }

    // =========================
    // 🔥 UPDATE PURCHASE ORDER INVOICE IDS
    // =========================
    await PurchaseOrder.findByIdAndUpdate(purchaseOrder._id, {
      $push: { invoiceIds: invoice._id },
    });

    console.log("🚀 AUTO CALLING INVOICE UPDATE API");

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