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
    // NOTE: cgst / sgst / igst are intentionally NOT destructured from
    // req.body anymore. GST for a bill is always derived from the order
    // being converted (see helpers above) — never trusted from the client.

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
    if (lineItems.length === 0) {
      res.status(400);
      throw new Error("At least one line item is required");
    }

    // Check if the order exists — this is now also our GST source of truth.
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

    // validate lineItems, and build the recalculated (GST-corrected) line
    // items in the same pass.
    const orderLineItems = Array.isArray(order.lineItems)
      ? order.lineItems
      : [];
    const usedOrderLineIds = new Set();
    const recalculatedLineItems = [];

    if (lineItems.length > 0) {
      for (const item of lineItems) {
        const product = await Product.findById(item?.product);

        if (!product) {
          return res.status(404).json({
            message: `Product not found for ID ${item?.product} as provided in line items payload`,
          });
        }

        if (item?.itemBillType !== "Replacement") {
          const price = await Price.findById(item?.price);
          if (!price) {
            return res.status(404).json({
              message: `Price not found for ID ${item?.price} as provided in line items payload`,
            });
          }
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

        // ── GST: scaled copy from the matching order line item ──
        // ratio = billQty / orderQty. 1 when billing the full quantity
        // (exact copy), <1 when qty was reduced/edited at bill time.
        const matchedOrderLine = matchOrderLineItem(
          orderLineItems,
          item,
          usedOrderLineIds,
        );

        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;
        let taxableAmt = safeNumber(item.taxableAmt);
        let netAmt = taxableAmt;

        if (matchedOrderLine) {
          usedOrderLineIds.add(String(matchedOrderLine._id));

          const orderQty = safeNumber(matchedOrderLine.oderQty);
          const billQty = safeNumber(item.billQty);
          const qtyRatio = orderQty > 0 ? billQty / orderQty : 0;

          taxableAmt = toTwoDecimal(
            safeNumber(matchedOrderLine.taxableAmt) * qtyRatio,
          );
          totalCGST = toTwoDecimal(
            safeNumber(matchedOrderLine.totalCGST) * qtyRatio,
          );
          totalSGST = toTwoDecimal(
            safeNumber(matchedOrderLine.totalSGST) * qtyRatio,
          );
          totalIGST = toTwoDecimal(
            safeNumber(matchedOrderLine.totalIGST) * qtyRatio,
          );
          netAmt = toTwoDecimal(taxableAmt + totalCGST + totalSGST + totalIGST);

          if (billQty > orderQty) {
            console.warn(
              `GST_QTY_OVERBILL: billQty (${billQty}) exceeds orderQty (${orderQty}) for product ${item?.product} on order ${orderId}; scaling anyway, please verify.`,
            );
          }
        } else {
          // No matching order line found — this should not normally happen
          // since a bill always originates from an order. Logged so it can
          // be investigated; GST is left at 0 rather than guessed.
          console.warn(
            `GST_COPY_MISS: no matching order line found for product ${item?.product} on order ${orderId}; GST left as 0 for this bill line.`,
          );
        }

        recalculatedLineItems.push({
          ...item,
          taxableAmt,
          totalCGST,
          totalSGST,
          totalIGST,
          netAmt,
          totalDiscountAmount: Number(item?.totalDiscountAmount || 0),
          totalDiscountPercentage: Number(item?.totalDiscountPercentage || 0),
        });
      }
    }

    // ── Header-level GST: sum of the SCALED line items above, plus tax on
    // this bill's own freight/delivery/handling charges. NOT a copy of the
    // order's header — the order's header reflects the full order quantity,
    // which may not equal what this specific bill is covering.
    const computedCGST = toTwoDecimal(
      recalculatedLineItems.reduce((sum, li) => sum + safeNumber(li.totalCGST), 0),
    );
    const computedSGST = toTwoDecimal(
      recalculatedLineItems.reduce((sum, li) => sum + safeNumber(li.totalSGST), 0),
    );
    const computedIGST = toTwoDecimal(
      recalculatedLineItems.reduce((sum, li) => sum + safeNumber(li.totalIGST), 0),
    );

    // Same flat 9/9/18 treatment on freight/delivery/handling as createOrderEntry,
    // so a bill's header GST stays consistent with how the order computed it.
    const additionalCharges =
      Number(freightCharges || 0) +
      Number(deliveryCharges || 0) +
      Number(handlingCharges || 0);

    const finalCgst = isSameState
      ? Number((computedCGST + additionalCharges * 0.09).toFixed(2))
      : 0;
    const finalSgst = isSameState
      ? Number((computedSGST + additionalCharges * 0.09).toFixed(2))
      : 0;
    const finalIgst = isSameState
      ? 0
      : Number((computedIGST + additionalCharges * 0.18).toFixed(2));

    console.log("=== GST SCALED FROM ORDER ENTRY (by qty) ===");
    console.log("orderId:", orderId);
    console.log(
      "matched order lines:",
      usedOrderLineIds.size,
      "of",
      orderLineItems.length,
    );
    console.log("finalCgst:", finalCgst, "finalSgst:", finalSgst, "finalIgst:", finalIgst);
    console.log("=============================================");
    // ──────────────────────────────────────────────────────────────────────────

    const billNo = await generateBillNo("INV", distributorId);

    // validate Bill no
    if (!billNo) {
      res.status(400);
      throw new Error("Failed to generate bill number");
    }

    // ─── Reserve stock atomically BEFORE bill creation ────────────────────────
    // Mirrors the multipleBillCreate pattern: reserve first, then create the bill,
    // and rollback reservations if the bill save (or any subsequent step) fails.
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
        vehicleNumber,
        adviceSlipLinks,
        lineItems: recalculatedLineItems,
        totalLines,
        totalBasePoints,
        grossAmount,
        schemeDiscount,
        distributorDiscount,
        taxableAmount,
        cgst: finalCgst,
        sgst: finalSgst,
        igst: finalIgst,
        invoiceAmount,
        roundOffAmount,
        cashDiscount,
        freightCharges,
        deliveryCharges,
        handlingCharges,
        netAmount,
        billedType: "Single",
        adjustedCreditNoteIds,
        adjustedReplacementIds,
        creditAmount,
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

    // update the order with the new bill — GST here is the SAME
    // order-derived finalCgst/finalSgst/finalIgst used on the bill, never
    // anything from req.body.
    await OrderEntry.findByIdAndUpdate(
      orderId,
      {
        $push: { billIds: newBill._id },

        $set: {
          freightCharges,
          deliveryCharges,
          handlingCharges,

          grossAmount,
          taxableAmount,
          cgst: finalCgst,
          sgst: finalSgst,
          igst: finalIgst,
          invoiceAmount,
          roundOffAmount,
          netAmount,
          creditAmount,

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

    const billLineItems = newBill?.lineItems;

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