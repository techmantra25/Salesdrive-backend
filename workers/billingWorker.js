const { Worker } = require("bullmq");
const connection = require("../redisConnection");
const Bill = require("../models/bill.model");
const Inventory = require("../models/inventory.model");
const OrderEntry = require("../models/orderEntry.model");
const OutletApproved = require("../models/outletApproved.model");
const Product = require("../models/product.model");
const Price = require("../models/price.model");
const CreditNoteModel = require("../models/creditNote.model");
const new_billSeries = require("../models/new_billseries.model");
const { generateBillNo } = require("../utils/codeGenerator");
const { billPrintUtil } = require("../controllers/bill/util/billPrintUtil");
const {
  allocateBillSeriesNumber,
  reclaimBillSeriesNumber,
} = require("../controllers/queueBills/utils/Billseriesallocator");

// ─── Shared ID helpers ─────────────────────────────────────────────────────────

const getId = (maybeObjOrId) => {
  if (!maybeObjOrId) return null;
  if (typeof maybeObjOrId === "string") return maybeObjOrId;
  if (typeof maybeObjOrId === "object") {
    if (maybeObjOrId._id) return String(maybeObjOrId._id);
    if (maybeObjOrId.id) return String(maybeObjOrId.id);
  }
  return null;
};

const sameId = (a, b) => {
  const ida = getId(a);
  const idb = getId(b);
  if (!ida || !idb) return false;
  return ida === idb;
};

// ─── Bill-create processor ─────────────────────────────────────────────────────

const processSingleBill = async (
  billData,
  distributorId,
  // FIX: preallocatedBillNo is ALWAYS null now because the controller no
  // longer allocates the series number upfront. The worker allocates it here,
  // atomically, right before the DB write. This eliminates the race where
  // rapid successive requests grab consecutive numbers and then fail in the
  // queue — leaving orphaned numbers and causing the wrong bill to be skipped.
  preallocatedBillNo,
  activeBillSeriesId,
) => {
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
    freightCharges,
    deliveryCharges,
    handlingCharges,
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
    billedType,
    adjustedCreditNoteIds,
    creditAmount,
    cashDiscountApplied,
    cashDiscountType,
    cashDiscountValue,
    billDate,
    isBackdated,
    billNo: incomingBillNo,
  } = billData;

  if (!lineItems || lineItems.length === 0) {
    throw new Error("At least one line item is required");
  }

  // ── Guard 1: preBillId idempotency ─────────────────────────────────────────
  // If BullMQ retries a job after a mid-save crash, the bill may already exist
  // under the pre-generated _id. Return it immediately — no duplicate created,
  // no new billNo consumed, no inventory double-deducted.
  if (preBillId) {
    const existingById = await Bill.findById(preBillId);
    if (existingById) {
      console.warn(
        `⚠️ Bill ${preBillId} already exists (likely a queue retry). Returning existing bill.`,
      );
      return existingById;
    }
  }

  const order = await OrderEntry.findById(orderId);
  if (!order) throw new Error("Order not found");

  if (["Completed_Billed", "Cancelled"].includes(order.status)) {
    throw new Error(`Order ${orderNo} is already fully billed or cancelled`);
  }

  const retailer = await OutletApproved.findById(retailerId);
  if (!retailer) throw new Error("Retailer not found");

  // ── Guard 2: billNo + distributorId idempotency ────────────────────────────
  if (incomingBillNo) {
    const existingByBillNo = await Bill.findOne({
      billNo: incomingBillNo,
      distributorId,
    });
    if (existingByBillNo) {
      console.warn(
        `⚠️ Bill with billNo ${incomingBillNo} already exists for distributor ${distributorId}. Skipping duplicate.`,
      );
      return existingByBillNo;
    }
  }

  // ── Validate all line items before touching anything ──────────────────────
  for (const [i, item] of lineItems.entries()) {
    const product = await Product.findById(item.product);
    if (!product) throw new Error(`Product not found for line item #${i + 1}`);

    if (item.inventoryId) {
      const invId = item.inventoryId?._id || item.inventoryId;
      const inventory = await Inventory.findById(invId);
      if (!inventory)
        throw new Error(`Inventory not found for line item #${i + 1}`);

      const qty = item.billQty ?? item.oderQty;

      if (Number(qty) < 0)
        throw new Error(`Negative qty on line item #${i + 1}`);

      if (qty > 0 && inventory.availableQty < qty) {
        item.billQty = 0;
        item.stockOut = true;
        console.warn(
          `⚠️ Stock out for ${product.product_code} — available: ${inventory.availableQty}, requested: ${qty}. Marking billQty=0.`,
        );
      }
    }
  }

  // ── Normalize line items ──────────────────────────────────────────────────
  const modifiedLineItems = lineItems.map((item) => ({
    ...item,
    billQty: item.billQty ?? item.oderQty,
    stockOut: item.stockOut ?? false,
  }));

  // ── Resolve bill date ─────────────────────────────────────────────────────
  const resolvedBillDate = billDate ? new Date(billDate) : new Date();
  const resolvedIsBackdated = isBackdated || false;

  // ── Reserve inventory BEFORE bill creation ────────────────────────────────
  const reservedInventories = [];
  for (const item of modifiedLineItems) {
    const invId = item.inventoryId?._id
      ? String(item.inventoryId._id)
      : item.inventoryId
        ? String(item.inventoryId)
        : null;

    if (invId && item.billQty > 0) {
      const updated = await Inventory.findOneAndUpdate(
        {
          _id: invId,
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

      if (!updated) {
        for (const r of reservedInventories) {
          await Inventory.findByIdAndUpdate(r.inventoryId, {
            $inc: { availableQty: r.qty, reservedQty: -r.qty },
          });
        }
        throw new Error(
          `Insufficient stock at reservation stage for billQty ${item.billQty}`,
        );
      }

      reservedInventories.push({
        inventoryId: invId,
        qty: Number(item.billQty),
      });
    }
  }

  // ── Resolve billNo — generate atomically, after inventory is reserved ─────
  let billNo = incomingBillNo;

  if (!billNo) {
    billNo = await generateBillNo("INV", distributorId);
    if (!billNo) {
      for (const r of reservedInventories) {
        await Inventory.findByIdAndUpdate(r.inventoryId, {
          $inc: { availableQty: r.qty, reservedQty: -r.qty },
        });
      }
      throw new Error(
        `Failed to generate INV bill number for distributor ${distributorId}`,
      );
    }

    // Sanity check — with atomic $inc this should never fire
    const raceCheck = await Bill.findOne({ billNo, distributorId });
    if (raceCheck) {
      for (const r of reservedInventories) {
        await Inventory.findByIdAndUpdate(r.inventoryId, {
          $inc: { availableQty: r.qty, reservedQty: -r.qty },
        });
      }
      console.warn(
        `⚠️ Race condition: freshly generated billNo ${billNo} already exists. Rethrowing to trigger retry.`,
      );
      throw new Error(`Race condition on billNo ${billNo} — safe to retry`);
    }
  }

  // ── FIX: Allocate bill series number HERE, not in the controller ──────────
  // The controller passes activeBillSeriesId but no pre-allocated number.
  // We allocate now — as close to Bill.create as possible — so that:
  //   1. Rapid back-to-back requests don't all grab numbers before any bill
  //      is written, making reclaim logic complex and error-prone.
  //   2. If anything above this point fails (stock check, billNo race), no
  //      series number is ever consumed.
  //   3. If Bill.create fails, we reclaim in the catch block below.
  // preallocatedBillNo will be null for all new requests; the parameter is
  // kept for backwards compatibility only.
  let resolvedNewBillNo = preallocatedBillNo || null;

  if (!resolvedNewBillNo && activeBillSeriesId) {
    try {
      resolvedNewBillNo = await allocateBillSeriesNumber(activeBillSeriesId);
    } catch (allocErr) {
      // Non-fatal: series allocation failure should not block bill creation.
      // Log the error and proceed without a series number.
      console.error(
        `⚠️ Failed to allocate bill series number for series ${activeBillSeriesId}:`,
        allocErr.message,
      );
      resolvedNewBillNo = null;
    }
  }

  // ── Guard: new_billno uniqueness check ────────────────────────────────────
  if (resolvedNewBillNo) {
    const existingByNewBillNo = await Bill.findOne({
      new_billno: resolvedNewBillNo,
      distributorId,
    });
    if (existingByNewBillNo) {
      // Roll back inventory before bailing
      for (const r of reservedInventories) {
        await Inventory.findByIdAndUpdate(r.inventoryId, {
          $inc: { availableQty: r.qty, reservedQty: -r.qty },
        });
      }
      // Reclaim the duplicate number
      await reclaimBillSeriesNumber(activeBillSeriesId, resolvedNewBillNo);
      console.error(
        `❌ Duplicate new_billno ${resolvedNewBillNo} detected for distributor ${distributorId}. Rolling back.`,
      );
      throw new Error(
        `Duplicate new_billno ${resolvedNewBillNo} — safe to retry.`,
      );
    }
  }

  // ── Create bill ───────────────────────────────────────────────────────────
  let savedBill;
  try {
    const newBill = new Bill({
      ...(preBillId && { _id: preBillId }),
      distributorId,
      new_billseriesid: activeBillSeriesId || null,
      new_billno: resolvedNewBillNo || null,
      billNo,
      orderId,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      lineItems: modifiedLineItems,
      totalLines: totalLines ?? 0,
      freightCharges: freightCharges || 0,
      deliveryCharges: deliveryCharges || 0,
      handlingCharges: handlingCharges || 0,
      totalBasePoints: totalBasePoints ?? 0,
      grossAmount: grossAmount ?? 0,
      schemeDiscount: schemeDiscount ?? 0,
      distributorDiscount: distributorDiscount ?? 0,
      taxableAmount: taxableAmount ?? 0,
      cgst: cgst ?? 0,
      sgst: sgst ?? 0,
      igst: igst ?? 0,
      invoiceAmount: invoiceAmount ?? 0,
      roundOffAmount: roundOffAmount ?? 0,
      cashDiscount: cashDiscount ?? 0,
      netAmount: netAmount ?? 0,
      billedType: billedType ?? "Bulk",
      status: "Pending",
      adjustedCreditNoteIds: adjustedCreditNoteIds || [],
      creditAmount: creditAmount || 0,
      cashDiscountApplied: cashDiscountApplied || false,
      cashDiscountType: cashDiscountType || "amount",
      cashDiscountValue: cashDiscountValue || 0,
      billDate: resolvedBillDate,
      enabledBackDate: resolvedIsBackdated,
      ...(resolvedIsBackdated && {
        createdAt: resolvedBillDate,
        updatedAt: resolvedBillDate,
      }),
    });

    savedBill = await newBill.save();
  } catch (saveErr) {
    // Roll back inventory reservations
    for (const r of reservedInventories) {
      await Inventory.findByIdAndUpdate(r.inventoryId, {
        $inc: { availableQty: r.qty, reservedQty: -r.qty },
      });
    }
    // Reclaim the series number since the bill was never saved
    if (resolvedNewBillNo && activeBillSeriesId) {
      await reclaimBillSeriesNumber(activeBillSeriesId, resolvedNewBillNo);
    }

    if (saveErr.code === 11000) {
      console.error(
        `❌ Duplicate billNo ${billNo} detected at DB save for distributor ${distributorId}:`,
        saveErr.message,
      );
      throw new Error(
        `Duplicate billNo ${billNo} — possible race condition. Safe to retry.`,
      );
    }
    throw saveErr;
  }

  const verifyBill = await Bill.findById(savedBill._id);
  if (!verifyBill) {
    throw new Error(`Bill save verification failed for ${savedBill._id}`);
  }

  if (resolvedIsBackdated) {
    await Bill.collection.updateOne(
      { _id: savedBill._id },
      { $set: { createdAt: resolvedBillDate, updatedAt: resolvedBillDate } },
    );

    const verifyBackdated = await Bill.findById(savedBill._id);
    if (!verifyBackdated) {
      throw new Error(
        `Backdated bill verification failed for ${savedBill._id}`,
      );
    }
  }

  // ── Update order ──────────────────────────────────────────────────────────
  await OrderEntry.findByIdAndUpdate(orderId, {
    $push: { billIds: savedBill._id },
  });

  const updatedOrder = await OrderEntry.findById(orderId)
    .populate([{ path: "billIds", select: "" }])
    .setOptions({ readPreference: "primary" });

  if (updatedOrder) {
    const activeBills = (updatedOrder.billIds || []).filter(
      (b) => b.status !== "Cancelled",
    );

    let newOrderStatus = "Completed_Billed";

    for (const orderItem of updatedOrder.lineItems || []) {
      const productId = getId(orderItem.product);

      const isStockedOut = modifiedLineItems.some(
        (li) => sameId(li.product, productId) && li.stockOut === true,
      );
      if (isStockedOut) continue;

      const totalBilledQty = activeBills.reduce((acc, bill) => {
        if (!Array.isArray(bill.lineItems)) return acc;
        const li = bill.lineItems.find((l) => sameId(l.product, productId));
        return acc + (li?.billQty || 0);
      }, 0);

      if (orderItem.oderQty > totalBilledQty) {
        newOrderStatus = "Partially_Billed";
        break;
      }
    }

    await OrderEntry.findByIdAndUpdate(orderId, { status: newOrderStatus });
  }

  // ── Update credit notes ───────────────────────────────────────────────────
  if (adjustedCreditNoteIds?.length > 0) {
    for (const adjustedCN of adjustedCreditNoteIds) {
      if (!adjustedCN?.creditNoteId) {
        console.warn(
          "⚠️ Skipping credit note update: creditNoteId is undefined",
        );
        continue;
      }

      try {
        const creditNote = await CreditNoteModel.findById(
          adjustedCN.creditNoteId,
        );
        if (!creditNote) continue;

        const entryIndex = creditNote.adjustedBillIds.findIndex(
          (entry) =>
            String(entry.orderId) === String(orderId) &&
            (!entry.billId || entry.billId === null),
        );

        if (entryIndex !== -1) {
          await CreditNoteModel.findByIdAndUpdate(adjustedCN.creditNoteId, {
            $set: {
              [`adjustedBillIds.${entryIndex}.billId`]: savedBill._id,
              [`adjustedBillIds.${entryIndex}.adjustedAmount`]:
                adjustedCN.adjustedAmount || 0,
            },
          });
        } else {
          await CreditNoteModel.findByIdAndUpdate(adjustedCN.creditNoteId, {
            $push: {
              adjustedBillIds: {
                billId: savedBill._id,
                orderId,
                adjustedAmount: adjustedCN.adjustedAmount || 0,
                type: "Order_To_Bill",
                collectionId: null,
              },
            },
          });
        }

        const refreshed = await CreditNoteModel.findById(
          adjustedCN.creditNoteId,
        );
        if (!refreshed) continue;

        const totalAdjusted = refreshed.adjustedBillIds.reduce(
          (sum, e) => sum + Number(e.adjustedAmount || 0),
          0,
        );

        const newStatus =
          totalAdjusted >= refreshed.amount ? "Completely Adjusted" : "Pending";

        await CreditNoteModel.findByIdAndUpdate(adjustedCN.creditNoteId, {
          creditNoteStatus: newStatus,
        });

        console.log(
          `✅ Credit note ${adjustedCN.creditNoteId} → billId set, status: ${newStatus}`,
        );
      } catch (cnErr) {
        console.error(
          `⚠️ Credit note update failed for ${adjustedCN.creditNoteId}:`,
          cnErr.message,
        );
      }
    }
  }

  return savedBill;
};

// ─── Bill-update processor ─────────────────────────────────────────────────────

const processBillUpdate = async ({ bid, previousBillData, newBillData }) => {
  const existingBill = await Bill.findById(bid);
  if (!existingBill) throw new Error("Bill not found");

  const oldLineItems = previousBillData?.lineItems || [];
  const newLineItems = newBillData?.lineItems || [];

  for (const item of newLineItems) {
    const inventoryId = getId(item.inventoryId);
    const productId = getId(item.product);
    const priceId = getId(item.price);

    const productDoc = productId ? await Product.findById(productId) : null;
    const productCodeForMsg =
      productDoc?.product_code || productId || "unknown product";

    if (item?.itemBillType === "Item Removed") continue;

    if (!inventoryId) {
      throw new Error(`Inventory not provided for ${productCodeForMsg}.`);
    }

    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) {
      throw new Error(`Inventory not found for ID ${inventoryId}`);
    }

    if (typeof item.billQty === "number" && item.billQty < 0) {
      throw new Error(`Invalid quantity for ${productCodeForMsg}`);
    }

    const oldItem = oldLineItems.find((old) => sameId(old.product, productId));
    const oldQty = oldItem ? Number(oldItem.billQty || 0) : 0;
    const newQty = Number(item.billQty || 0);
    const additionalQty = newQty - oldQty;

    if (additionalQty > 0 && additionalQty > inventory.availableQty) {
      throw new Error(
        `Insufficient stock for ${productCodeForMsg}. Available: ${inventory.availableQty}, Additional needed: ${additionalQty}`,
      );
    }

    if (item?.itemBillType !== "Replacement") {
      if (!priceId) {
        throw new Error(`Price id missing for product ${productCodeForMsg}`);
      }
      const priceDoc = await Price.findById(priceId);
      if (!priceDoc) {
        throw new Error(`Price not found for ID ${priceId}`);
      }
    }
  }

  const sanitisedLineItems = Array.isArray(newBillData.lineItems)
    ? newBillData.lineItems.map((it) => {
      const sanitised = {
        ...it,
        product: getId(it.product) || null,
        price: getId(it.price) || null,
        inventoryId: getId(it.inventoryId) || null,
      };
      if (sanitised._id && String(sanitised._id).startsWith("new_")) {
        delete sanitised._id;
      }
      return sanitised;
    })
    : newBillData.lineItems;

  const sanitisedBillData = { ...newBillData, lineItems: sanitisedLineItems };

  const updatedBill = await Bill.findOneAndUpdate(
    { _id: bid },
    { $set: sanitisedBillData },
    { new: true },
  );
  if (!updatedBill) throw new Error("Bill not updated");

  const oldAdjustedCreditNotes = previousBillData.adjustedCreditNoteIds || [];
  const newAdjustedCreditNotes = newBillData.adjustedCreditNoteIds || [];

  const removedCreditNotes = oldAdjustedCreditNotes.filter(
    (old) =>
      !newAdjustedCreditNotes.find(
        (nc) => String(nc.creditNoteId) === String(old.creditNoteId),
      ),
  );

  for (const removed of removedCreditNotes) {
    try {
      await CreditNoteModel.findByIdAndUpdate(removed.creditNoteId, {
        $pull: { adjustedBillIds: { billId: bid } },
      });

      const cn = await CreditNoteModel.findById(removed.creditNoteId);
      if (cn) {
        const totalAdjusted = cn.adjustedBillIds.reduce(
          (sum, e) => sum + (e.adjustedAmount || 0),
          0,
        );
        await CreditNoteModel.findByIdAndUpdate(removed.creditNoteId, {
          creditNoteStatus:
            totalAdjusted >= cn.amount ? "Completely Adjusted" : "Pending",
        });
      }
    } catch (err) {
      console.error(
        `⚠️ Credit note removal failed for ${removed.creditNoteId}:`,
        err.message,
      );
    }
  }

  if (newAdjustedCreditNotes.length > 0) {
    const creditNoteIds = newAdjustedCreditNotes.map((i) => i.creditNoteId);
    const creditNotes = await CreditNoteModel.find({
      _id: { $in: creditNoteIds },
    });

    for (const creditNote of creditNotes) {
      try {
        const adjustedEntry = newAdjustedCreditNotes.find(
          (i) => String(i.creditNoteId) === String(creditNote._id),
        );
        if (!adjustedEntry) continue;

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;
        const existingAdjustment = creditNote.adjustedBillIds.find(
          (adj) => String(adj.billId) === String(updatedBill._id),
        );

        if (existingAdjustment) {
          await CreditNoteModel.findOneAndUpdate(
            { _id: creditNote._id, "adjustedBillIds.billId": updatedBill._id },
            { $set: { "adjustedBillIds.$.adjustedAmount": adjustedAmount } },
            { new: true },
          );
        } else {
          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            {
              $push: {
                adjustedBillIds: {
                  billId: updatedBill._id,
                  adjustedAmount,
                  type: "Order_To_Bill",
                  collectionId: null,
                },
              },
            },
            { new: true },
          );
        }

        const refreshed = await CreditNoteModel.findById(creditNote._id);
        const totalAdjusted = refreshed.adjustedBillIds.reduce(
          (sum, e) => sum + (e.adjustedAmount || 0),
          0,
        );
        await CreditNoteModel.findByIdAndUpdate(creditNote._id, {
          creditNoteStatus:
            totalAdjusted >= refreshed.amount
              ? "Completely Adjusted"
              : "Pending",
        });
      } catch (err) {
        console.error(
          `⚠️ Credit note update failed for ${creditNote._id}:`,
          err.message,
        );
      }
    }
  }

  const inventoryAdjustments = new Map();

  for (const oldItem of oldLineItems) {
    const inventoryId = getId(oldItem.inventoryId);
    if (!inventoryId) continue;
    const current = inventoryAdjustments.get(inventoryId) || {
      oldTotal: 0,
      newTotal: 0,
    };
    current.oldTotal += Number(oldItem.billQty || 0);
    inventoryAdjustments.set(inventoryId, current);
  }

  for (const newItem of sanitisedLineItems) {
    const inventoryId = getId(newItem.inventoryId);
    if (!inventoryId) continue;
    const current = inventoryAdjustments.get(inventoryId) || {
      oldTotal: 0,
      newTotal: 0,
    };
    current.newTotal += Number(newItem.billQty || 0);
    inventoryAdjustments.set(inventoryId, current);
  }

  for (const [inventoryId, { oldTotal, newTotal }] of inventoryAdjustments) {
    const diff = newTotal - oldTotal;
    if (diff === 0) continue;

    if (diff > 0) {
      const updated = await Inventory.findOneAndUpdate(
        { _id: inventoryId, availableQty: { $gte: diff } },
        { $inc: { availableQty: -diff, reservedQty: diff } },
        { new: true },
      );
      if (!updated) {
        throw new Error(
          `Insufficient stock to increase bill quantity by ${diff} units (inventory ${inventoryId}).`,
        );
      }
    } else {
      const returnQty = Math.abs(diff);
      await Inventory.findOneAndUpdate(
        { _id: inventoryId },
        { $inc: { availableQty: returnQty, reservedQty: -returnQty } },
        { new: true },
      );
    }
  }

  const orderId = existingBill.orderId;
  if (orderId) {
    const order = await OrderEntry.findById(orderId)
      .populate([{ path: "billIds", select: "" }])
      .setOptions({ readPreference: "primary" });

    if (order) {
      const billList = order.billIds || [];
      const activeBills = billList.filter((b) => b.status !== "Cancelled");

      if (activeBills.length === 0) {
        await OrderEntry.findByIdAndUpdate(orderId, { status: "Pending" });
      } else {
        const orderLineItems = order.lineItems || [];
        let newStatus = "Completed_Billed";

        for (const item of orderLineItems) {
          const productId = getId(item.product);
          const totalBilledQty = activeBills.reduce((acc, bill) => {
            if (!Array.isArray(bill.lineItems)) return acc;
            const li = bill.lineItems.find((l) => sameId(l.product, productId));
            return acc + (li?.billQty || 0);
          }, 0);

          if (item.oderQty > totalBilledQty) {
            newStatus = "Partially_Billed";
            break;
          }
        }

        await OrderEntry.findByIdAndUpdate(orderId, { status: newStatus });
      }
    }
  }

  return updatedBill;
};

// ─── Bill-cancel processor ─────────────────────────────────────────────────────

const processBillCancel = async ({ billIds }) => {
  if (!Array.isArray(billIds) || billIds.length === 0) {
    throw new Error("Invalid or empty billIds array");
  }

  const billIdArray = billIds.map((item) => item.bid);
  const bills = await Bill.find({ _id: { $in: billIdArray } });

  if (bills.length === 0) throw new Error("No bills found to cancel");

  const invalidBills = bills.filter(
    (bill) => bill.status === "Cancelled" || bill.status === "Delivered",
  );

  if (invalidBills.length > 0) {
    throw new Error(
      `Some bills cannot be cancelled (already cancelled or delivered): ${invalidBills
        .map((b) => `${b.billNo} (${b.status})`)
        .join(", ")}`,
    );
  }

  const distributorIds = new Set(
    bills.map((bill) => String(bill.distributorId)).filter(Boolean),
  );

  const inventoryUpdateErrors = [];
  const updatedInventories = [];

  for (const bill of bills) {
    if (!bill.lineItems || bill.lineItems.length === 0) continue;

    for (const item of bill.lineItems) {
      if (!item.inventoryId) continue;

      const billQty = item.billQty ?? 0;
      if (billQty <= 0) continue;

      const updated = await Inventory.findOneAndUpdate(
        { _id: item.inventoryId, reservedQty: { $gte: billQty } },
        { $inc: { availableQty: billQty, reservedQty: -billQty } },
        { new: true, runValidators: true },
      );

      if (!updated) {
        const current = await Inventory.findById(item.inventoryId);
        inventoryUpdateErrors.push({
          billNo: bill.billNo,
          inventoryId: item.inventoryId,
          billQty,
          error:
            `Insufficient reserved quantity. ` +
            `Current reservedQty: ${current?.reservedQty || 0}, ` +
            `Bill requires: ${billQty}.`,
        });
      } else {
        updatedInventories.push(updated._id);
      }
    }
  }

  if (inventoryUpdateErrors.length > 0) {
    throw new Error(
      `Inventory release failed for ${inventoryUpdateErrors.length} item(s): ` +
      inventoryUpdateErrors.map((e) => e.error).join(" | "),
    );
  }

  const updateOps = billIds.map(({ bid, remark }) =>
    Bill.updateOne(
      { _id: bid },
      {
        status: "Cancelled",
        dates: { cancelledDate: new Date() },
        billRemark: remark,
      },
    ),
  );

  await Promise.all(updateOps);

  for (const bill of bills) {
    const orderId = bill.orderId;
    if (!orderId) continue;

    try {
      const order = await OrderEntry.findById(orderId)
        .populate([
          { path: "billIds", select: "" },
          { path: "lineItems.product", select: "" },
        ])
        .setOptions({ readPreference: "primary" });

      if (!order) continue;

      const activeBills = (order.billIds || []).filter(
        (b) => b.status !== "Cancelled",
      );

      if (activeBills.length === 0) {
        await OrderEntry.findByIdAndUpdate(orderId, { status: "Pending" });
        continue;
      }

      let newStatus = "Completed_Billed";
      for (const orderItem of order.lineItems) {
        const productId = String(orderItem.product?._id || orderItem.product);
        const totalBilledQty = activeBills.reduce((acc, b) => {
          if (!Array.isArray(b.lineItems)) return acc;
          const li = b.lineItems.find(
            (l) => String(l.product?._id || l.product) === productId,
          );
          return acc + (li?.billQty || 0);
        }, 0);

        if (orderItem.oderQty > totalBilledQty) {
          newStatus = "Partially_Billed";
          break;
        }
      }

      await OrderEntry.findByIdAndUpdate(orderId, { status: newStatus });
    } catch (err) {
      console.error(
        `⚠️ Failed to update order ${orderId} status:`,
        err.message,
      );
    }
  }

  const { checkAndUpdatePortalLock } = require("../utils/checkPortalLock");
  for (const distributorId of distributorIds) {
    try {
      await checkAndUpdatePortalLock(distributorId);
    } catch (err) {
      console.error(
        `⚠️ Portal lock update failed for ${distributorId}:`,
        err.message,
      );
    }
  }

  return {
    cancelledCount: bills.length,
    updatedInventories: updatedInventories.length,
    details: bills.map((bill) => ({
      billNo: bill.billNo,
      status: "Cancelled",
      inventoryItemsUpdated: bill.lineItems.filter(
        (item) => item.inventoryId && item.billQty > 0,
      ).length,
    })),
  };
};

// ─── Job handlers ──────────────────────────────────────────────────────────────

const handleBillCreateJob = async (job) => {
  const { distributorId, bills } = job.data;

  const savedBills = [];
  const skippedBills = [];

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    try {
      // FIX: Pass null for preallocatedBillNo — the worker now allocates the
      // series number internally in processSingleBill, just before Bill.create.
      // This means we never pre-consume a number that might not get used, and
      // reclaim logic is contained entirely within processSingleBill's own
      // catch block — no reclaim loop needed here.
      const savedBill = await processSingleBill(
        bill,
        distributorId,
        bill.newbillNo || null,                           // preallocatedBillNo — always null now
        bill.activeBillSeriesId || null,
      );
      savedBills.push(savedBill);

    } catch (err) {
      console.error(`❌ Bill ${i + 1} in batch failed: ${err.message}`);
      skippedBills.push({
        index: i + 1,
        orderId: bill?.orderId,
        orderNo: bill?.orderNo,
        error: err.message,
        // newbillNo is no longer pre-allocated, so nothing to reclaim here
      });
    }
  }

  // NOTE: The old reclaim loop over skippedBills is removed. processSingleBill
  // now reclaims the series number itself in its own catch block, so there is
  // nothing left to reclaim at this level.

  if (savedBills.length > 0) {
    billPrintUtil(savedBills.map((b) => b._id));
  }

  return {
    processed: savedBills.length,
    skipped: skippedBills.length,
    skippedBills,
    billIds: savedBills.map((b) => b._id),
  };
};

const handleBillUpdateJob = async (job) => {
  const { bid, previousBillData, newBillData } = job.data;

  const updatedBill = await processBillUpdate({
    bid,
    previousBillData,
    newBillData,
  });

  billPrintUtil([updatedBill._id]);

  return { billId: updatedBill._id };
};

const handleBillCancelJob = async (job) => {
  const { billIds } = job.data;
  const result = await processBillCancel({ billIds });
  return result;
};

// ─── Worker ───────────────────────────────────────────────────────────────────

const billingWorker = new Worker(
  "billing",
  async (job) => {
    if (job.name === "update-bill") {
      return await handleBillUpdateJob(job);
    }
    if (job.name === "cancel-bills") {
      return await handleBillCancelJob(job);
    }
    return await handleBillCreateJob(job);
  },
  {
    connection,
    concurrency: 1,
    removeOnComplete: true,
    removeOnFail: {
      age: 3600,
      count: 500,
    },
  },
);

// ─── Events ───────────────────────────────────────────────────────────────────

billingWorker.on("completed", (job, result) => {
  if (job.name === "update-bill") {
    console.log(`✅ Bill update job ${job.id} done — billId: ${result.billId}`);
  } else if (job.name === "cancel-bills") {
    console.log(
      `✅ Bill cancel job ${job.id} done — cancelled: ${result.cancelledCount}`,
    );
  } else {
    console.log(
      `✅ Billing job ${job.id} done — processed: ${result.processed}, skipped: ${result.skipped}`,
    );
  }
});

billingWorker.on("failed", (job, err) => {
  console.error(
    `❌ Billing job ${job?.id} (${job?.name}) failed:`,
    err.message,
  );
});

billingWorker.on("error", (err) => {
  console.error("🚨 Billing worker crashed:", err);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
  console.log("🛑 Closing billing worker...");
  await billingWorker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = {
  billingWorker,
  processSingleBill,
  processBillUpdate,
  processBillCancel,
};