const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const new_billSeries = require("../../models/new_billseries.model");
const CreditNoteModel = require("../../models/creditNote.model");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const { billPrintUtil } = require("../bill/util/billPrintUtil");
const {
  getOrderToBillBackdate,
} = require("../../utils/backdateOrdertoBillHelper");
const { billStockQueue, canEnqueue } = require("../../queues/billStockQueue");
const { processSingleBill } = require("../../workers/billingWorker");
const {
  bulkAllocateBillSeriesNumbers,
  reclaimBillSeriesNumber,
} = require("./utils/Billseriesallocator");

// --- Helpers ------------------------------------------------------------------

const isInvalidNumber = (value) =>
  isNaN(Number(value)) || value === null || value === undefined;

const resolveBillDate = (row, order, billDeliverySetting) => {
  if (!billDeliverySetting) {
    return { billDate: new Date(), isBackdated: false };
  }

  if (row._billDateEpoch) {
    return {
      billDate: new Date(Number(row._billDateEpoch)),
      isBackdated: true,
    };
  }

  const createdAtSource = row._createdAtEpoch
    ? new Date(Number(row._createdAtEpoch))
    : row.createdAt
      ? row.createdAt instanceof Date
        ? row.createdAt
        : new Date(row.createdAt)
      : null;

  if (createdAtSource) {
    return getOrderToBillBackdate(
      createdAtSource,
      billDeliverySetting.enableBackdateBilling,
      new Date(),
    );
  }

  if (order._billDateEpoch) {
    return {
      billDate: new Date(Number(order._billDateEpoch)),
      isBackdated: true,
    };
  }

  const orderCreatedAt = order._createdAtEpoch
    ? new Date(Number(order._createdAtEpoch))
    : order.createdAt instanceof Date
      ? order.createdAt
      : new Date(order.createdAt ?? Date.now());

  return getOrderToBillBackdate(
    orderCreatedAt,
    billDeliverySetting.enableBackdateBilling,
    new Date(),
  );
};

// --- Controller ---------------------------------------------------------------

const multipleBillCreate = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;
    const { data } = req.body;

    // --- 1. Input validation --------------------------------------------------
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res
        .status(400)
        .json({ message: "data is required and must be a non-empty array" });
    }

    // --- 2. Bill series (fetched once — needed for allocation) ----------------
    const today = new Date();
    const activeBillSeries = await new_billSeries
      .findOne({
        distributorId,
        startDate: { $lte: today },
        $or: [{ endDate: { $gte: today } }, { endDate: null }],
      })
      .sort({ startDate: -1 });

    // --- 3. Bill delivery setting ---------------------------------------------
    const billDeliverySetting = await BillDeliverySetting.findOne({
      distributorId,
      isActive: true,
    });

    // --- 4. Validate each row, collect valid payloads -------------------------
    // billNo (INV series) is intentionally NOT generated here. It is generated
    // inside processSingleBill at the last possible moment, right before the
    // DB write. This eliminates the window where a number is consumed but the
    // bill never saves.
    //
    // new_billSeries numbers are still allocated here (step 5) because they
    // require a bulk allocation call and the reclaim pool handles any failures
    // cleanly without the counter ever going backward.
    const validatedPayloads = [];
    const skippedRows = [];

    for (let index = 0; index < data.length; index++) {
      const row = data[index];
      try {
        const {
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
          cgst,
          sgst,
          igst,
          invoiceAmount,
          roundOffAmount,
          cashDiscount,
          netAmount,
          billedType,
        } = row;

        // 4a. Line items presence
        if (!lineItems || lineItems.length === 0) {
          throw new Error("At least one line item is required");
        }

        // 4b. Numeric field sanity
        if (
          isInvalidNumber(totalLines) ||
          isInvalidNumber(totalBasePoints) ||
          isInvalidNumber(grossAmount) ||
          isInvalidNumber(schemeDiscount) ||
          isInvalidNumber(distributorDiscount) ||
          isInvalidNumber(taxableAmount) ||
          isInvalidNumber(cgst) ||
          isInvalidNumber(sgst) ||
          isInvalidNumber(igst) ||
          isInvalidNumber(invoiceAmount) ||
          isInvalidNumber(roundOffAmount) ||
          isInvalidNumber(cashDiscount) ||
          isInvalidNumber(netAmount)
        ) {
          throw new Error("One or more numeric fields contain invalid values");
        }

        // 4c. Order check
        const order = await OrderEntry.findById(orderId);
        if (!order) throw new Error("Order not found");

        if (
          ["Completed_Billed", "Partially_Billed", "Cancelled"].includes(
            order.status,
          )
        ) {
          throw new Error(
            `Order ${orderNo} has already been billed, partially billed, or cancelled`,
          );
        }

        // 4d. Retailer check
        const retailer = await OutletApproved.findById(retailerId);
        if (!retailer) throw new Error("Retailer not found");

        // 4e. Line item validation
        for (const [itemIndex, item] of lineItems.entries()) {
          const product = await Product.findById(item?.product);
          if (!product) {
            throw new Error(
              `Product not found for line item #${itemIndex + 1}`,
            );
          }

          const price = await Price.findById(item?.price);
          if (!price) {
            throw new Error(
              `Price not found for line item #${itemIndex + 1}`,
            );
          }

          if (item.inventoryId) {
            const inventoryId = item.inventoryId?._id || item.inventoryId;
            const inventory = await Inventory.findById(inventoryId);
            if (!inventory) {
              throw new Error(
                `Inventory not found for line item #${itemIndex + 1}`,
              );
            }

            if (Number(item.oderQty) < 0) {
              throw new Error(
                `Negative oderQty on line item #${itemIndex + 1}`,
              );
            }

            if (item.oderQty > 0 && inventory.availableQty < item.oderQty) {
              console.warn(
                `Stock out for ${product.product_code} — available: ${inventory.availableQty}, requested: ${item.oderQty}. Marking billQty=0.`,
              );
              item.oderQty = 0;
              item.stockOut = true;
            }
          }
        }

        // 4f. Bill date
        const { billDate, isBackdated } = resolveBillDate(
          row,
          order,
          billDeliverySetting,
        );

        // 4g. Pre-generate a MongoDB ObjectId so the caller gets it back
        // immediately even on the queued path. The worker's preBillId
        // idempotency guard uses this to safely handle queue retries.
        const preBillId = new Bill.base.Types.ObjectId();

        // billNo is absent from this payload intentionally — see note above
        validatedPayloads.push({
          _id: preBillId.toString(),
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
          cgst,
          sgst,
          igst,
          invoiceAmount,
          roundOffAmount,
          cashDiscount,
          netAmount,
          billedType: billedType ?? "Bulk",
          adjustedCreditNoteIds: order.adjustedCreditNoteIds || [],
          creditAmount: order.creditAmount || 0,
          cashDiscountApplied: order.cashDiscountApplied || false,
          cashDiscountType: order.cashDiscountType || "amount",
          cashDiscountValue: order.cashDiscountValue || 0,
          // newbillNo and activeBillSeriesId stamped in step 5
          billDate: billDate.toISOString(),
          isBackdated,
        });
      } catch (err) {
        skippedRows.push({
          rowIndex: index + 1,
          orderId: row?.orderId,
          orderNo: row?.orderNo,
          error: err.message,
        });
      }
    }

    if (validatedPayloads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid bills to process",
        processedCount: 0,
        skippedCount: skippedRows.length,
        skippedRows,
      });
    }

    // --- 5. Allocate new_billSeries numbers — only for valid rows -------------
    // bulkAllocateBillSeriesNumbers drains the reclaim pool first, then
    // increments fresh. Exactly validatedPayloads.length numbers are consumed.
    // Validation failures never touched the counter so no rollback is needed
    // for them.
    let allocatedNumbers = [];
    if (activeBillSeries) {
      allocatedNumbers = await bulkAllocateBillSeriesNumbers(
        activeBillSeries._id,
        validatedPayloads.length,
      );
    }

    // Stamp each valid payload with its assigned new_billSeries number
    const billPayloads = validatedPayloads.map((payload, i) => ({
      ...payload,
      newbillNo: allocatedNumbers[i] || null,
      activeBillSeriesId: activeBillSeries?._id?.toString() || null,
    }));

    // --- 6. Try queue path first ----------------------------------------------
    const redisAvailable = await canEnqueue();

    if (redisAvailable) {
      try {
        const job = await billStockQueue.add("process-bills", {
          distributorId: String(distributorId),
          bills: billPayloads,
        });

        console.log(
          `Bulk bills queued — jobId: ${job.id}, count: ${billPayloads.length}`,
        );

        return res.status(202).json({
          success: true,
          message: "Bills queued for processing",
          jobId: job.id,
          queuedCount: billPayloads.length,
          billIds: billPayloads.map((p) => p._id),
          skippedCount: skippedRows.length,
          skippedRows,
        });
      } catch (queueErr) {
        console.warn(
          "Queue.add() failed, falling back to direct processing:",
          queueErr.message,
        );

        // Reclaim all allocated new_billSeries numbers before the direct path
        // runs. The direct path calls processSingleBill which goes through the
        // same worker function and will re-allocate nothing — new_billNo is
        // still in the payload. We only reclaim if queue.add itself threw,
        // meaning the job was never enqueued and the worker will never run.
        // The numbers are still in billPayloads so we reclaim them here and
        // null them out so the direct path below does not try to use stale
        // allocations.
        for (const payload of billPayloads) {
          if (payload.newbillNo && payload.activeBillSeriesId) {
            await reclaimBillSeriesNumber(
              payload.activeBillSeriesId,
              payload.newbillNo,
            );
            payload.newbillNo = null;
          }
        }
      }
    }

    // --- 7. Direct fallback path (Redis down or queue.add failed) -------------
    console.log(
      `Processing ${billPayloads.length} bills directly (Redis unavailable)`,
    );

    const savedBills = [];
    const failedBills = [];

    for (let i = 0; i < billPayloads.length; i++) {
      const payload = billPayloads[i];
      try {
        const savedBill = await processSingleBill(
          payload,
          distributorId,
          payload.newbillNo || null,
          activeBillSeries?._id?.toString() || null,
        );
        savedBills.push(savedBill);
      } catch (err) {
        console.error(`Bill ${i + 1} failed: ${err.message}`);
        failedBills.push({
          index: i + 1,
          orderId: payload?.orderId,
          orderNo: payload?.orderNo,
          error: err.message,
        });

        // Reclaim the new_billSeries number for this specific failed bill so
        // no gap is left. billNo (INV series) was generated inside
        // processSingleBill and is handled there — no reclaim needed here.
        if (payload.newbillNo && payload.activeBillSeriesId) {
          await reclaimBillSeriesNumber(
            payload.activeBillSeriesId,
            payload.newbillNo,
          );
        }
      }
    }

    if (savedBills.length > 0) billPrintUtil(savedBills.map((b) => b._id));

    return res.status(201).json({
      success: true,
      message: "Bills processed directly",
      processedCount: savedBills.length,
      skippedCount: skippedRows.length + failedBills.length,
      skippedRows: [...skippedRows, ...failedBills],
      bills: savedBills,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { multipleBillCreate };