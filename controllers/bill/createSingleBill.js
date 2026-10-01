const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const {
  generateBillNo,
  generateNextBillNumber,
} = require("../../utils/codeGenerator");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const {
  getOrderToBillBackdate,
} = require("../../utils/backdateOrdertoBillHelper");
const getOrderStatusToBe = require("./util/getOrderStatusToBe");
const { billPrintUtil } = require("./util/billPrintUtil");
const CreditNoteModel = require("../../models/creditNote.model");
const Replacement = require("../../models/replacement.model");
const Distributor = require("../../models/distributor.model");
const new_billSeries = require("../../models/new_billseries.model");

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toTwoDecimal = (value) => Number(safeNumber(value).toFixed(2));

// GST slabs are multiples of 0.5%. Snap a rate derived from rounded rupee
// amounts (e.g. 79.98 / 888.62 = 8.9997%) back to the real slab (9%), so
// recomputed GST matches exactly what the frontend shows.
const snapRate = (pct) => {
  const nearest = Math.round(pct * 2) / 2;
  return Math.abs(pct - nearest) < 0.15 ? nearest : Number(pct.toFixed(4));
};

// Report (not trust) any amount where the client's number differs from the
// server's recalculated number.
const logMismatch = (label, clientValue, serverValue) => {
  if (Math.abs(safeNumber(clientValue) - safeNumber(serverValue)) > 0.01) {
    console.warn(
      `BILL_TOTAL_MISMATCH [${label}]: client sent ${clientValue}, server recalculated ${serverValue} (server value saved)`,
    );
  }
};

// Match a bill line item to the corresponding order line item.
// Priority:
//   1. Explicit link field, if the frontend sends one (orderLineItemId).
//   2. product + inventoryId (handles same product billed from different
//      inventory batches).
//   3. product + price (handles same product at different price entries).
//   4. First not-yet-consumed order line item for that product.
// `usedOrderLineIds` prevents the same order line from being matched twice
// when a bill splits one order line into multiple bill lines.
const matchOrderLineItem = (orderLineItems, billItem, usedOrderLineIds) => {
  const availableLines = orderLineItems.filter(
    (ol) => !usedOrderLineIds.has(String(ol._id)),
  );

  if (billItem.orderLineItemId) {
    const byId = availableLines.find(
      (ol) => String(ol._id) === String(billItem.orderLineItemId),
    );
    if (byId) return byId;
  }

  const byProductAndInventory = availableLines.find(
    (ol) =>
      String(ol.product) === String(billItem.product) &&
      billItem.inventoryId &&
      ol.inventoryId &&
      String(ol.inventoryId) === String(billItem.inventoryId),
  );
  if (byProductAndInventory) return byProductAndInventory;

  const byProductAndPrice = availableLines.find(
    (ol) =>
      String(ol.product) === String(billItem.product) &&
      billItem.price &&
      ol.price &&
      String(ol.price) === String(billItem.price),
  );
  if (byProductAndPrice) return byProductAndPrice;

  const byProductOnly = availableLines.find(
    (ol) => String(ol.product) === String(billItem.product),
  );
  return byProductOnly || null;
};

const createSingleBill = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;

    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const {
      orderId,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      vehicleNumber,
      godownId,
      lineItems,
      totalLines,
      totalBasePoints,
      freightCharges,
      deliveryCharges,
      handlingCharges,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      orderStatusToBe,
      adjustedCreditNoteIds,
      creditAmount,
      adjustedReplacementIds,
      adviceSlipLinks,
    } = req.body;
    // NOTE: every monetary total below (gross, discount, taxable, GST,
    // invoice, round-off, credit, net, line count, base points) is
    // RECALCULATED on the server. The values above are only used to log a
    // warning when the client disagrees with the server.

    console.log("Received request body2222:", req.body);

    const today = new Date();

    const activeBillSeries = await new_billSeries
      .findOne({
        distributorId,
        startDate: { $lte: today },
        $or: [{ endDate: { $gte: today } }, { endDate: null }],
      })
      .sort({ startDate: -1 });

    let newbillNo = null;

    if (activeBillSeries) {
      newbillNo = await generateNextBillNumber(activeBillSeries._id);
    }

    // Validate required fields
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      res.status(400);
      throw new Error("At least one line item is required");
    }

    // Check if the order exists — this is also our GST source of truth.
    const order = await OrderEntry.findById(orderId);
    if (!order) {
      res.status(404);
      throw new Error("Order not found");
    }

    // Check if the retailer exists
    const retailer = await OutletApproved.findById(retailerId);
    if (!retailer) {
      res.status(404);
      throw new Error("Retailer not found");
    }

    // ─── Resolve the godown this bill is billed against ───────────────────────
    const finalGodownId = godownId || order?.godownId || null;
    // ─────────────────────────────────────────────────────────────────────────

    // ─── Fetch & validate distributor/retailer state BEFORE any further processing ───
    const distributorStateId = distributor?.stateId
      ? String(distributor.stateId)
      : null;
    const retailerStateId = retailer?.stateId
      ? String(retailer.stateId)
      : null;

    if (!distributorStateId) {
      res.status(400);
      throw new Error(
        "Distributor state is missing. Cannot determine tax type.",
      );
    }

    if (!retailerStateId) {
      res.status(400);
      throw new Error("Retailer state is missing. Cannot determine tax type.");
    }

    const isSameState = distributorStateId === retailerStateId;
    // ──────────────────────────────────────────────────────────────────────────

    // validate lineItems, and build the fully recalculated line items in the
    // same pass.
    const orderLineItems = Array.isArray(order.lineItems)
      ? order.lineItems
      : [];
    const usedOrderLineIds = new Set();
    const recalculatedLineItems = [];

    for (const item of lineItems) {
      const product = await Product.findById(item?.product);

      if (!product) {
        return res.status(404).json({
          message: `Product not found for ID ${item?.product} as provided in line items payload`,
        });
      }

      const isReplacement = item?.itemBillType === "Replacement";

      let priceDoc = null;
      if (!isReplacement) {
        priceDoc = await Price.findById(item?.price);
        if (!priceDoc) {
          return res.status(404).json({
            message: `Price not found for ID ${item?.price} as provided in line items payload`,
          });
        }
      }

      const billQtyNum = safeNumber(item.billQty);
      if (billQtyNum < 0) {
        return res.status(400).json({
          message: `Bill quantity cannot be negative for product ${product?.product_code}`,
        });
      }

      if (item.inventoryId) {
        const inventory = await Inventory.findById(item?.inventoryId);

        if (!inventory) {
          return res.status(400).json({
            message: `Inventory not found for ID ${item?.inventoryId} as provided in line items payload`,
          });
        } else {
          if (item.billQty > 0 && inventory.availableQty < item.billQty) {
            return res.status(400).json({
              message: `Insufficient stock for product ID ${product?.product_code}. Available: ${inventory.availableQty}, Requested: ${item.billQty}`,
            });
          }
        }
      } else {
        return res.status(400).json({
          message: `Inventory not found for product ID ${product?.product_code}. Please ensure inventory is there for the product for distributor with db code ${distributor.dbCode}.`,
        });
      }

      // Replacement lines never match a normal order line.
      const matchedOrderLine = isReplacement
        ? null
        : matchOrderLineItem(orderLineItems, item, usedOrderLineIds);

      if (matchedOrderLine) {
        usedOrderLineIds.add(String(matchedOrderLine._id));
      }

      let grossAmt = 0;
      let taxableAmt = 0;
      let totalCGST = 0;
      let totalSGST = 0;
      let totalIGST = 0;
      let netAmt = 0;
      let lineDiscount = 0; // rupee discount for the whole line
      let lineDiscountPercent = 0; // same discount as a % of list price (saved on the line)
      let totalDiscountPercentage = safeNumber(item?.totalDiscountPercentage);

      // Only lines that are actually billed carry amounts. Stock Out,
      // Item Removed (billQty 0) and Replacement lines stay at zero.
      if (!isReplacement && billQtyNum > 0) {
        const rlp = safeNumber(priceDoc?.rlp_price);
        const mrp = safeNumber(priceDoc?.mrp_price);

        // 1) GROSS: always list price (from DB) x bill qty.
        grossAmt = toTwoDecimal(rlp * billQtyNum);

        // 2) TAXABLE: the effective price the user actually billed at
        //    (reflects any discount edit at bill time). If the client did
        //    not send one, fall back to the order line scaled by qty.
        const hasSentPrice =
          item.billPrice !== undefined &&
          item.billPrice !== null &&
          item.billPrice !== "";
        const sentPrice = hasSentPrice ? safeNumber(item.billPrice) : null;

        if (sentPrice !== null && sentPrice < 0) {
          return res.status(400).json({
            message: `Effective price cannot be negative for product ${product?.product_code}`,
          });
        }

        if (sentPrice !== null) {
          taxableAmt = toTwoDecimal(sentPrice * billQtyNum);
        } else if (matchedOrderLine) {
          const orderQty = safeNumber(matchedOrderLine.oderQty);
          const qtyRatio = orderQty > 0 ? billQtyNum / orderQty : 0;
          taxableAmt = toTwoDecimal(
            safeNumber(matchedOrderLine.taxableAmt) * qtyRatio,
          );
          console.warn(
            `BILL_PRICE_MISSING: no billPrice sent for product ${item?.product}; scaled taxable from order line.`,
          );
        } else {
          taxableAmt = toTwoDecimal(safeNumber(item.taxableAmt));
          console.warn(
            `BILL_PRICE_MISSING: no billPrice and no order line for product ${item?.product}; using client taxableAmt.`,
          );
        }

        // 3) DISCOUNT: derived, so it can never disagree with gross/taxable.
        //    (Negative = reverse/special discount, kept as is.)
        lineDiscount = toTwoDecimal(grossAmt - taxableAmt);

        // 3b) The same discount expressed as a percentage of list price.
        //     This is what gets saved on the line (distributorDisc, unit
        //     "percent"). It is per-unit, so it does not depend on qty.
        //     4 decimals keeps the effective price reconstructable.
        lineDiscountPercent =
          grossAmt > 0
            ? Number(((lineDiscount / grossAmt) * 100).toFixed(4))
            : 0;

        // 4) GST RATES: reuse the order line's effective rate when there is
        //    one (keeps the slab the order was priced with); otherwise use
        //    the product's own rates with the same 2500/unit slab rule the
        //    frontend uses.
        const orderTaxable = safeNumber(matchedOrderLine?.taxableAmt);
        const orderRate = (orderGstAmt) =>
          snapRate((safeNumber(orderGstAmt) / orderTaxable) * 100);

        let cgstRate = safeNumber(product?.cgst);
        let sgstRate = safeNumber(product?.sgst);
        let igstRate = safeNumber(product?.igst);

        if (matchedOrderLine && orderTaxable > 0) {
          if (isSameState) {
            cgstRate = orderRate(matchedOrderLine.totalCGST);
            sgstRate = orderRate(matchedOrderLine.totalSGST);
          } else {
            igstRate = orderRate(matchedOrderLine.totalIGST);
          }
        } else {
          if (igstRate <= 0 && (cgstRate > 0 || sgstRate > 0)) {
            igstRate = cgstRate + sgstRate;
          }
          if ((cgstRate <= 0 || sgstRate <= 0) && igstRate > 0) {
            cgstRate = cgstRate > 0 ? cgstRate : igstRate / 2;
            sgstRate = sgstRate > 0 ? sgstRate : igstRate / 2;
          }
          const perUnit = taxableAmt / billQtyNum;
          if (perUnit >= 2500) {
            if (cgstRate === 2.5) cgstRate = 9;
            if (sgstRate === 2.5) sgstRate = 9;
            if (igstRate === 5) igstRate = 18;
          }
        }

        if (isSameState) {
          totalCGST = toTwoDecimal((taxableAmt * cgstRate) / 100);
          totalSGST = toTwoDecimal((taxableAmt * sgstRate) / 100);
          totalIGST = 0;
        } else {
          totalCGST = 0;
          totalSGST = 0;
          totalIGST = toTwoDecimal((taxableAmt * igstRate) / 100);
        }

        netAmt = toTwoDecimal(taxableAmt + totalCGST + totalSGST + totalIGST);

        // 5) Total discount % vs MRP, from the real effective price.
        if (mrp > 0) {
          totalDiscountPercentage = toTwoDecimal(
            ((mrp - taxableAmt / billQtyNum) / mrp) * 100,
          );
        }

        if (matchedOrderLine && billQtyNum > safeNumber(matchedOrderLine.oderQty)) {
          console.warn(
            `QTY_OVERBILL: billQty (${billQtyNum}) exceeds orderQty (${safeNumber(
              matchedOrderLine.oderQty,
            )}) for product ${item?.product} on order ${orderId}; please verify.`,
          );
        }
      }

      recalculatedLineItems.push({
        ...item,
        grossAmt,
        // Special discount is saved as a PERCENTAGE of list price per item.
        // The rupee value of the line discount is kept in totalDiscountAmount.
        distributorDisc: lineDiscountPercent,
        distributorDiscUnit: "percent",
        taxableAmt,
        totalCGST,
        totalSGST,
        totalIGST,
        netAmt,
        totalDiscountAmount: toTwoDecimal(lineDiscount),
        totalDiscountPercentage,
        // base point per unit comes from the product, not the client
        usedBasePoint: safeNumber(product?.base_point),
      });
    }

    // ── Header totals: ALL derived from the recalculated lines ──
    const billedLines = recalculatedLineItems.filter(
      (li) => safeNumber(li.billQty) > 0 && li.itemBillType !== "Replacement",
    );
    const sumOf = (rows, key) =>
      toTwoDecimal(rows.reduce((s, li) => s + safeNumber(li[key]), 0));

    const finalGrossAmount = sumOf(billedLines, "grossAmt");
    const finalTaxableAmount = sumOf(billedLines, "taxableAmt");
    const finalDistributorDiscount = toTwoDecimal(
      finalGrossAmount - finalTaxableAmount,
    );
    const finalTotalLines = billedLines.length;
    const finalTotalBasePoints = Math.round(
      billedLines.reduce(
        (s, li) => s + safeNumber(li.usedBasePoint) * safeNumber(li.billQty),
        0,
      ),
    );

    const computedCGST = sumOf(billedLines, "totalCGST");
    const computedSGST = sumOf(billedLines, "totalSGST");
    const computedIGST = sumOf(billedLines, "totalIGST");

    // Same flat 9/9/18 treatment on freight/delivery/handling as createOrderEntry.
    const additionalCharges =
      Number(freightCharges || 0) +
      Number(deliveryCharges || 0) +
      Number(handlingCharges || 0);

    const finalCgst = isSameState
      ? toTwoDecimal(computedCGST + additionalCharges * 0.09)
      : 0;
    const finalSgst = isSameState
      ? toTwoDecimal(computedSGST + additionalCharges * 0.09)
      : 0;
    const finalIgst = isSameState
      ? 0
      : toTwoDecimal(computedIGST + additionalCharges * 0.18);

    // Taxable shown on the bill includes the extra charges (same as before).
    const finalTaxableWithCharges = toTwoDecimal(
      finalTaxableAmount + additionalCharges,
    );

    const finalInvoiceAmount = toTwoDecimal(
      finalTaxableWithCharges + finalCgst + finalSgst + finalIgst,
    );
    const finalRoundOffAmount = Math.round(finalInvoiceAmount);

    // Credit comes from the adjustments themselves, not from a client total.
    const finalCreditAmount = toTwoDecimal(
      (adjustedCreditNoteIds || []).reduce(
        (s, c) => s + safeNumber(c.adjustedAmount),
        0,
      ),
    );
    const finalNetAmount = finalRoundOffAmount - finalCreditAmount;

    if (finalNetAmount < 0) {
      return res.status(400).json({
        message: "Net amount cannot be negative",
      });
    }

    // Log every place the client disagreed with the server.
    logMismatch("totalLines", totalLines, finalTotalLines);
    logMismatch("totalBasePoints", totalBasePoints, finalTotalBasePoints);
    logMismatch("grossAmount", grossAmount, finalGrossAmount);
    logMismatch("distributorDiscount", distributorDiscount, finalDistributorDiscount);
    logMismatch("taxableAmount", taxableAmount, finalTaxableWithCharges);
    logMismatch("invoiceAmount", invoiceAmount, finalInvoiceAmount);
    logMismatch("roundOffAmount", roundOffAmount, finalRoundOffAmount);
    logMismatch("creditAmount", creditAmount, finalCreditAmount);
    logMismatch("netAmount", netAmount, finalNetAmount);

    console.log("=== BILL TOTALS RECALCULATED ON SERVER ===");
    console.log("orderId:", orderId);
    console.log(
      "matched order lines:",
      usedOrderLineIds.size,
      "of",
      orderLineItems.length,
    );
    console.log({
      finalGrossAmount,
      finalDistributorDiscount,
      finalTaxableWithCharges,
      finalCgst,
      finalSgst,
      finalIgst,
      finalInvoiceAmount,
      finalRoundOffAmount,
      finalCreditAmount,
      finalNetAmount,
    });
    console.log("finalGodownId:", finalGodownId);
    console.log("==========================================");
    // ──────────────────────────────────────────────────────────────────────────

    const billNo = await generateBillNo("INV", distributorId);

    // validate Bill no
    if (!billNo) {
      res.status(400);
      throw new Error("Failed to generate bill number");
    }

    // ─── Reserve stock atomically BEFORE bill creation ────────────────────────
    const reservedInventories = [];
    try {
      for (const item of lineItems) {
        if (item.inventoryId && item.billQty > 0) {
          const updatedInv = await Inventory.findOneAndUpdate(
            {
              _id: item.inventoryId,
              availableQty: { $gte: Number(item.billQty) },
            },
            {
              $inc: {
                availableQty: -Number(item.billQty),
                reservedQty: Number(item.billQty),
              },
            },
            { new: true, runValidators: true },
          );

          if (!updatedInv) {
            for (const r of reservedInventories) {
              await Inventory.findByIdAndUpdate(r.inventoryId, {
                $inc: { availableQty: r.qty, reservedQty: -r.qty },
              });
            }
            res.status(400);
            throw new Error(
              `Insufficient stock for product. Available stock is less than requested quantity (${item.billQty}).`,
            );
          }

          reservedInventories.push({
            inventoryId: item.inventoryId,
            qty: Number(item.billQty),
          });
        }
      }
    } catch (reserveErr) {
      throw reserveErr;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const billDeliverySetting = await BillDeliverySetting.findOne({
      distributorId,
      isActive: true,
    });

    let billDate = new Date();
    let isBackdated = false;

    if (billDeliverySetting) {
      if (req.body && req.body._billDateEpoch) {
        billDate = new Date(Number(req.body._billDateEpoch));
        isBackdated = true;
      } else if (req.body && req.body._createdAtEpoch) {
        const createdAtDate = new Date(Number(req.body._createdAtEpoch));
        const result = getOrderToBillBackdate(
          createdAtDate,
          billDeliverySetting.enableBackdateOrder,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      } else if (req.body && req.body.createdAt) {
        const createdAtDate =
          req.body.createdAt instanceof Date
            ? req.body.createdAt
            : new Date(req.body.createdAt);
        const result = getOrderToBillBackdate(
          createdAtDate,
          billDeliverySetting.enableBackdateOrder,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      } else if (order && order._billDateEpoch) {
        billDate = new Date(Number(order._billDateEpoch));
        isBackdated = true;
      } else {
        const orderCreatedAtDate =
          order && order._createdAtEpoch
            ? new Date(Number(order._createdAtEpoch))
            : order && order.createdAt
              ? order.createdAt instanceof Date
                ? order.createdAt
                : new Date(order.createdAt)
              : new Date();

        const result = getOrderToBillBackdate(
          orderCreatedAtDate,
          billDeliverySetting.enableBackdateOrder,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      }
    }

    // Create the bill — wrapped in try/catch so we can rollback reserved stock
    // if the save or any subsequent mutation fails.
    let newBill;
    try {
      newBill = await Bill.create({
        distributorId,
        new_billseriesid: activeBillSeries ? activeBillSeries._id : null,
        new_billno: newbillNo,
        billNo,
        orderId,
        orderNo,
        salesmanName,
        cso: order?.cso,
        routeId,
        retailerId,
        godownId: finalGodownId,
        vehicleNumber,
        adviceSlipLinks,
        lineItems: recalculatedLineItems,
        totalLines: finalTotalLines,
        totalBasePoints: finalTotalBasePoints,
        grossAmount: finalGrossAmount,
        schemeDiscount,
        distributorDiscount: finalDistributorDiscount,
        taxableAmount: finalTaxableWithCharges,
        cgst: finalCgst,
        sgst: finalSgst,
        igst: finalIgst,
        invoiceAmount: finalInvoiceAmount,
        roundOffAmount: finalRoundOffAmount,
        cashDiscount,
        freightCharges,
        deliveryCharges,
        handlingCharges,
        netAmount: finalNetAmount,
        billedType: "Single",
        adjustedCreditNoteIds,
        adjustedReplacementIds,
        creditAmount: finalCreditAmount,
        cashDiscountApplied: req.body.cashDiscountApplied || false,
        cashDiscountType: req.body.cashDiscountType || "amount",
        cashDiscountValue: req.body.cashDiscountValue || 0,
        billDate,
        enabledBackDate: isBackdated,
        ...(isBackdated && { createdAt: billDate, updatedAt: billDate }),
      });
    } catch (billSaveErr) {
      for (const r of reservedInventories) {
        await Inventory.findByIdAndUpdate(r.inventoryId, {
          $inc: { availableQty: r.qty, reservedQty: -r.qty },
        });
      }
      throw billSaveErr;
    }

    if (isBackdated) {
      await Bill.collection.updateOne(
        { _id: newBill._id },
        { $set: { createdAt: billDate, updatedAt: billDate } },
      );
    }

    // update the order with the new bill — same server-calculated values
    // that were saved on the bill (now including distributorDiscount, so the
    // order header stays internally consistent).
    await OrderEntry.findByIdAndUpdate(
      orderId,
      {
        $push: { billIds: newBill._id },

        $set: {
          freightCharges,
          deliveryCharges,
          handlingCharges,

          grossAmount: finalGrossAmount,
          distributorDiscount: finalDistributorDiscount,
          taxableAmount: finalTaxableWithCharges,
          cgst: finalCgst,
          sgst: finalSgst,
          igst: finalIgst,
          invoiceAmount: finalInvoiceAmount,
          roundOffAmount: finalRoundOffAmount,
          netAmount: finalNetAmount,
          creditAmount: finalCreditAmount,

          lineItems: recalculatedLineItems,
        },
      },
      { new: true },
    );

    const orderEntry = await OrderEntry.findById(orderId).populate([
      { path: "billIds", select: "" },
    ]);

    const billList = orderEntry?.billIds;
    const LineItems = orderEntry?.lineItems;

    const getOrderStatus = getOrderStatusToBe(billList, LineItems);

    await OrderEntry.findByIdAndUpdate(
      orderId,
      {
        $set: { status: getOrderStatus },
      },
      { new: true },
    );

    // Inventory was already reserved atomically before bill creation above.
    // No further inventory updates are required here.

    const newBillId = newBill?._id;

    billPrintUtil([newBillId]);

    if (adjustedCreditNoteIds.length) {
      const creditNoteIds = adjustedCreditNoteIds.map(
        (item) => item.creditNoteId,
      );

      const creditNotes = await CreditNoteModel.find({
        _id: { $in: creditNoteIds },
      });

      for (const creditNote of creditNotes) {
        const billId = newBill._id;

        const adjustedEntry = adjustedCreditNoteIds.find(
          (item) => item.creditNoteId == creditNote._id,
        );

        if (!adjustedEntry) continue;

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;

        const currentCreditNote = await CreditNoteModel.findById(
          creditNote._id,
        );

        const entryIndex = currentCreditNote.adjustedBillIds.findIndex(
          (entry) =>
            String(entry.orderId) === String(orderId) &&
            (!entry.billId || entry.billId === null),
        );

        if (entryIndex !== -1) {
          const updatePath = `adjustedBillIds.${entryIndex}.billId`;

          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            {
              $set: {
                [updatePath]: billId,
              },
            },
            { new: true },
          );
        }

        const updatedCreditNote = await CreditNoteModel.findById(
          creditNote._id,
        );

        const totalAdjusted = updatedCreditNote.adjustedBillIds.reduce(
          (sum, entry) => sum + entry.adjustedAmount,
          0,
        );

        if (totalAdjusted >= updatedCreditNote.amount) {
          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            { creditNoteStatus: "Completely Adjusted" },
            { new: true },
          );
        }
      }
    }

    if (adjustedReplacementIds.length) {
      const replacementIds = adjustedReplacementIds.map(
        (item) => item.replacementId,
      );

      const replacements = await Replacement.find({
        _id: { $in: replacementIds },
      });

      for (const replacement of replacements) {
        const billId = newBill._id;

        const adjustedEntry = adjustedReplacementIds.find(
          (item) => item.replacementId == replacement._id,
        );

        if (!adjustedEntry) continue;

        const adjustedQty = adjustedEntry.adjustedQty || 0;

        await Replacement.findByIdAndUpdate(
          replacement._id,
          {
            $push: {
              adjustedBillIds: {
                billId,
                adjustedQty,
              },
            },
            $set: {
              status: "Completely Adjusted",
            },
          },
          { new: true },
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: newBill,
      billList: billList,
      LineItems: LineItems,
      getOrderStatus: getOrderStatus,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createSingleBill };