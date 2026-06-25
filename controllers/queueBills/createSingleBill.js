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
const getOrderStatusToBe = require("../bill/util/getOrderStatusToBe");
const { billPrintUtil } = require("../bill/util/billPrintUtil");
const CreditNoteModel = require("../../models/creditNote.model");
const Replacement = require("../../models/replacement.model");
const Distributor = require("../../models/distributor.model");
const new_billSeries = require("../../models/new_billseries.model");
const { billStockQueue, canEnqueue } = require("../../queues/billStockQueue");
const {
  allocateBillSeriesNumber,
  reclaimBillSeriesNumber,
} = require("./utils/Billseriesallocator");

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
      lineItems,
      freightCharges,
      adviceSlipLink,
      totalLines,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      orderStatusToBe,
      adjustedCreditNoteIds,
      creditAmount,
      adjustedReplacementIds,
    } = req.body;

    console.log("Adsvice slip",adviceSlipLink )

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
      console.log(`generating new billno ${newbillNo}`);
    }
    console.log(`active bill series ${activeBillSeries}`);

    // Validate required fields
    if (lineItems.length === 0) {
      res.status(400);
      throw new Error("At least one line item is required");
    }

    // Check if the order exists
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

    // validate lineItems
    if (lineItems.length > 0) {
      for (const item of lineItems) {
        console.log({ item: item });

        const product = await Product.findById(item?.product);
        console.log({ product: product });

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
          console.log({ inventoryId: item.inventoryId });

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
      }
    }

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
        freightCharges,
        routeId,
        retailerId,
        adviceSlipLink,
        lineItems,
        totalLines,
        totalBasePoints,
        grossAmount,
        schemeDiscount,
        distributorDiscount,
        taxableAmount,
        cgst,
        sgst,
        igst,
        invoiceAmount,
        roundOffAmount,
        cashDiscount,
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
      // Rollback all reserved inventory before propagating the error
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

    // update the order with the new bill
    await OrderEntry.findByIdAndUpdate(
      orderId,
      { $push: { billIds: newBill?._id } },
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
      { $set: { status: getOrderStatus } },
      { new: true },
    );

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
            { $set: { [updatePath]: billId } },
            { new: true },
          );
          console.log(
            `✅ Updated credit note ${creditNote._id} - added billId ${billId} to existing entry at index ${entryIndex}`,
          );
        } else {
          console.warn(
            `⚠️ No matching orderId entry found in credit note ${creditNote._id} - this may indicate an issue`,
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
            $push: { adjustedBillIds: { billId, adjustedQty } },
            $set: { status: "Completely Adjusted" },
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

// --- Direct processing (Redis-down fallback) ----------------------------------
// This function mirrors what the queue worker does. It allocates the bill
// series number atomically just before the DB write and reclaims it if the
// Bill.create fails, ensuring no gap or orphan in the series.




const processDirectSingleBill = async ({
  billPayload,
  distributorId,
  activeBillSeries,
  billDate,
  isBackdated,
}) => {
  const {
    _id: preBillId,
    orderId,
    orderNo,
    salesmanName,
    routeId,
    retailerId,
    lineItems,
    totalLines,
    totalBasePoints,
    grossAmount,
    schemeDiscount,
    distributorDiscount,
    taxableAmount,
    freightCharges,
    cgst,
    sgst,
    igst,
    invoiceAmount,
    roundOffAmount,
    adviceSlipLink,
    cashDiscount,
    netAmount,
    billedType,
    adjustedCreditNoteIds,
    creditAmount,
    cashDiscountApplied,
    cashDiscountType,
    cashDiscountValue,
    adjustedReplacementIds,
  } = billPayload;

  // --- Server-side tax re-validation (defence in depth) --------------------
  const distributor = await Distributor.findById(distributorId);
  if (!distributor) throw new Error("Distributor not found");

  const retailer = await OutletApproved.findById(retailerId);
  if (!retailer) throw new Error("Retailer not found");

  const serverIsIGST = distributor.state !== retailer.state;

  const sumLine = (field) =>
    (lineItems || []).reduce((s, it) => s + Number(it[field] || 0), 0);

  let topCgst = typeof cgst === "number" ? cgst : Number(cgst) || 0;
  let topSgst = typeof sgst === "number" ? sgst : Number(sgst) || 0;
  let topIgst = typeof igst === "number" ? igst : Number(igst) || 0;

  if (!serverIsIGST) {
    if (topCgst === 0 && topSgst === 0 && topIgst > 0) {
      const half = Number((topIgst / 2).toFixed(2));
      topCgst = half;
      topSgst = half;
    }
    if (topCgst === 0 && topSgst === 0) {
      topCgst = sumLine("totalCGST");
      topSgst = sumLine("totalSGST");
    }
    topIgst = 0;
  } else {
    if (topIgst === 0) topIgst = sumLine("totalIGST");
    topCgst = 0;
    topSgst = 0;
  }

  const validatedCgst = topCgst;
  const validatedSgst = topSgst;
  const validatedIgst = topIgst;

  // Guard 1: preBillId idempotency
  if (preBillId) {
    const existingById = await Bill.findById(preBillId);
    if (existingById) {
      console.warn(
        `Bill ${preBillId} already exists (duplicate direct request). Returning existing bill.`,
      );
      return existingById;
    }
  }

  const order = await OrderEntry.findById(orderId);
  if (!order) throw new Error("Order not found");

  // Generate billNo atomically — right before the DB write.
  const billNo = await generateBillNo("INV", distributorId);
  if (!billNo) {
    throw new Error(
      `Failed to generate INV bill number for distributor ${distributorId}`,
    );
  }

  // Guard 2: billNo + distributorId idempotency
  const existingByBillNo = await Bill.findOne({ billNo, distributorId });
  if (existingByBillNo) {
    console.warn(
      `Bill with billNo ${billNo} already exists for distributor ${distributorId}. Returning existing bill.`,
    );
    return existingByBillNo;
  }

  // FIX: Allocate the bill series number here, just before the DB write.
  let newbillNo = null;
  if (activeBillSeries) {
    newbillNo = await allocateBillSeriesNumber(activeBillSeries._id);
  }

  // Reserve stock atomically BEFORE bill creation
  const reservedInventories = [];
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
        // Roll back any reservations already made
        for (const r of reservedInventories) {
          await Inventory.findByIdAndUpdate(r.inventoryId, {
            $inc: { availableQty: r.qty, reservedQty: -r.qty },
          });
        }
        // Also reclaim the series number we just allocated
        if (newbillNo && activeBillSeries) {
          await reclaimBillSeriesNumber(activeBillSeries._id, newbillNo);
        }
        throw new Error(
          `Insufficient stock at reservation stage (billQty: ${item.billQty})`,
        );
      }

      reservedInventories.push({
        inventoryId: item.inventoryId,
        qty: Number(item.billQty),
      });
    }
  }

  // Create bill
  let newBill;
  try {
    newBill = await Bill.create({
      ...(preBillId && { _id: preBillId }),
      distributorId,
      new_billseriesid: activeBillSeries?._id || null,
      new_billno: newbillNo || null,
      billNo,
      orderId,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      adviceSlipLink,
      lineItems,
      totalLines: totalLines ?? 0,
      totalBasePoints: totalBasePoints ?? 0,
      grossAmount: grossAmount ?? 0,
      schemeDiscount: schemeDiscount ?? 0,
      distributorDiscount: distributorDiscount ?? 0,
      taxableAmount: taxableAmount ?? 0,
      cgst: validatedCgst ?? 0,
      sgst: validatedSgst ?? 0,
      igst: validatedIgst ?? 0,
      invoiceAmount: invoiceAmount ?? 0,
      roundOffAmount: roundOffAmount ?? 0,
      cashDiscount: cashDiscount ?? 0,
      netAmount: netAmount ?? 0,
      billedType: billedType ?? "Single",
      adjustedCreditNoteIds: adjustedCreditNoteIds || [],
      adjustedReplacementIds: adjustedReplacementIds || [],
      creditAmount: creditAmount || 0,
      freightCharges: freightCharges || 0,
      cashDiscountApplied: cashDiscountApplied || false,
      cashDiscountType: cashDiscountType || "amount",
      cashDiscountValue: cashDiscountValue || 0,
      billDate,
      enabledBackDate: isBackdated,
      ...(isBackdated && { createdAt: billDate, updatedAt: billDate }),
    });
  } catch (billSaveErr) {
    // Roll back inventory reservations
    for (const r of reservedInventories) {
      await Inventory.findByIdAndUpdate(r.inventoryId, {
        $inc: { availableQty: r.qty, reservedQty: -r.qty },
      });
    }
    // Reclaim the series number since the bill was never saved
    if (newbillNo && activeBillSeries) {
      await reclaimBillSeriesNumber(activeBillSeries._id, newbillNo);
    }

    if (billSaveErr.code === 11000) {
      console.error(
        `Duplicate billNo ${billNo} detected at DB save for distributor ${distributorId}:`,
        billSaveErr.message,
      );
      throw new Error(
        `Duplicate billNo ${billNo} — possible race condition. Safe to retry.`,
      );
    }

    throw billSaveErr;
  }

  if (isBackdated) {
    await Bill.collection.updateOne(
      { _id: newBill._id },
      { $set: { createdAt: billDate, updatedAt: billDate } },
    );
  }

  await OrderEntry.findByIdAndUpdate(orderId, {
    $push: { billIds: newBill._id },
  });

  return newBill;
};

// --- Credit note handler ------------------------------------------------------

const handleCreditNotes = async ({
  savedBill,
  orderId,
  adjustedCreditNoteIds,
}) => {
  if (!adjustedCreditNoteIds?.length) return;

  const creditNotes = await CreditNoteModel.find({
    _id: { $in: adjustedCreditNoteIds.map((i) => i.creditNoteId) },
  });

  for (const creditNote of creditNotes) {
    try {
      const adjustedEntry = adjustedCreditNoteIds.find(
        (i) => String(i.creditNoteId) === String(creditNote._id),
      );
      if (!adjustedEntry) continue;

      const current = await CreditNoteModel.findById(creditNote._id);
      const entryIndex = current.adjustedBillIds.findIndex(
        (entry) =>
          String(entry.orderId) === String(orderId) &&
          (!entry.billId || entry.billId === null),
      );

      if (entryIndex !== -1) {
        await CreditNoteModel.findByIdAndUpdate(creditNote._id, {
          $set: { [`adjustedBillIds.${entryIndex}.billId`]: savedBill._id },
        });
      } else {
        console.warn(
          `No matching entry in credit note ${creditNote._id} for order ${orderId}`,
        );
      }

      const updated = await CreditNoteModel.findById(creditNote._id);
      const totalAdjusted = updated.adjustedBillIds.reduce(
        (sum, e) => sum + (e.adjustedAmount || 0),
        0,
      );
      if (totalAdjusted >= updated.amount) {
        await CreditNoteModel.findByIdAndUpdate(creditNote._id, {
          $set: { creditNoteStatus: "Completely Adjusted" },
        });
      }
    } catch (err) {
      console.error(
        `Credit note update failed for ${creditNote._id}:`,
        err.message,
      );
    }
  }
};

// --- Replacement handler ------------------------------------------------------

const handleReplacements = async ({ savedBill, adjustedReplacementIds }) => {
  if (!adjustedReplacementIds?.length) return;

  const replacements = await Replacement.find({
    _id: { $in: adjustedReplacementIds.map((i) => i.replacementId) },
  });

  for (const replacement of replacements) {
    try {
      const adjustedEntry = adjustedReplacementIds.find(
        (i) => String(i.replacementId) === String(replacement._id),
      );
      if (!adjustedEntry) continue;

      await Replacement.findByIdAndUpdate(replacement._id, {
        $push: {
          adjustedBillIds: {
            billId: savedBill._id,
            adjustedQty: adjustedEntry.adjustedQty || 0,
          },
        },
        $set: { status: "Completely Adjusted" },
      });
    } catch (err) {
      console.error(
        `Replacement update failed for ${replacement._id}:`,
        err.message,
      );
    }
  }
};

const getBillJobStatus = asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  try {
    const job = await billStockQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ status: "not_found" });
    }
    const state = await job.getState(); // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
    const result = state === "completed" ? await job.returnvalue : null;
    const failReason = state === "failed" ? job.failedReason : null;

    return res.json({ status: state, result, failReason });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = { createSingleBill, getBillJobStatus };
