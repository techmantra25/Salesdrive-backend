const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const CreditNoteModel = require("../../models/creditNote.model");
const { orderNumberGenerator } = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config.js");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const { getOrderBackdate } = require("../../utils/backdateOrderHelper");
const OutletApproved = require("../../models/outletApproved.model");

// ─────────────────────────────────────────────────────────────────────────
// GST helpers — mirrors the logic used in the bulk-import controller so both
// paths compute tax identically. Kept local to this file to avoid coupling.
// ─────────────────────────────────────────────────────────────────────────

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toTwoDecimal = (value) => Number(safeNumber(value).toFixed(2));

// Product schema stores cgst/sgst/igst as String — safeNumber() handles the
// coercion, but note "" or null both fall through to 0 via safeNumber.
const getStateIdentity = (state) => {
  if (!state) return "";
  if (typeof state === "object") {
    return String(state.code || state.slug || state._id || state).trim();
  }
  return String(state).trim();
};

const getIsIgst = ({ distributor, retailer }) => {
  const distributorState = getStateIdentity(distributor?.stateId);
  const retailerState = getStateIdentity(retailer?.stateId);
  return (
    distributorState && retailerState && distributorState !== retailerState
  );
};

const getApplicableTaxRate = ({ product, taxableAmt, qty }) => {
  let cgst = safeNumber(product?.cgst);
  let sgst = safeNumber(product?.sgst);
  let igst = safeNumber(product?.igst);

  // Product has no tax rate configured at all — fall back to standard 18% GST.
  if (!cgst && !sgst && !igst) {
    cgst = 9;
    sgst = 9;
    igst = 18;
  }

  const taxablePricePerProduct = qty > 0 ? taxableAmt / qty : 0;

  // Slab bump: low-value-slab rate (2.5/2.5/5) upgrades to standard (9/9/18)
  // once the per-unit taxable price crosses ₹2500.
  if (taxablePricePerProduct >= 2500) {
    if (cgst === 2.5) cgst = 9;
    if (sgst === 2.5) sgst = 9;
    if (igst === 5) igst = 18;
  }

  return { cgst, sgst, igst };
};

// Create Order Entry
const createOrderEntry = asyncHandler(async (req, res) => {
  try {
    const {
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderRemark,
      orderSource,
      freightCharges,
      deliveryCharges,
      handlingCharges,
      manualOrderDate,
      paymentMode,
      lineItems,
      totalLines,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      shipToAddress,
      validity,
      deliveryTerms,
      deliverySchedule,
      paymentTerms,
      remarks,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      adjustedCreditNoteIds,
      creditAmount,
      isBillCreate,
    } = req.body;
    // NOTE: cgst/sgst/igst are intentionally NOT destructured/used from
    // req.body anymore — they are always recomputed server-side below,
    // both per line item and at the order header level.

    console.log("Received createOrderEntry request with data:", req.body);

    const distributorId = req.user.id;

    // Validate distributor — populate stateId so we can determine
    // interstate (IGST) vs intrastate (CGST+SGST) for this order.
    const distributor = await Distributor.findById(distributorId).populate(
      "stateId",
    );
    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }
    const outlet = await OutletApproved.findById(retailerId).populate(
      "stateId",
    );

    if (!outlet) {
      return res.status(404).json({
        message: "Outlet not found",
      });
    }

    const isIgst = getIsIgst({ distributor, retailer: outlet });
    const recalculatedLineItems = [];

    // Validate each line item for product, price, and inventory, AND
    // recompute its GST server-side from the product's actual tax rate
    // instead of trusting whatever CGST/SGST/IGST split the client sent.
    for (const item of lineItems) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res
          .status(404)
          .json({ message: `Product not found for ID ${item.product}` });
      }

      const price = await Price.findById(item.price);
      if (!price) {
        return res
          .status(404)
          .json({ message: `Price not found for ID ${item.price}` });
      }

      if (item.inventoryId) {
        const inventory = await Inventory.findById(item.inventoryId);
        if (!inventory) {
          return res.status(404).json({
            message: `Inventory not found for ID ${item.inventoryId}`,
          });
        }
      }

      // making sure that the oder quantity does not goes negative
      const qty = Number(item.oderQty);
      if (qty < 0) {
        return res.status(400).json({
          message: `Negative quantity not allowed for product ${item.product}`,
        });
      }

      // taxableAmt is still trusted from the client (it depends on
      // discount/pricing logic validated upstream) — only the tax SPLIT
      // and tax AMOUNTS are recomputed server-side here.
      const taxableAmt = safeNumber(item.taxableAmt);
      const taxRate = getApplicableTaxRate({ product, taxableAmt, qty });

      const totalCGST = isIgst
        ? 0
        : toTwoDecimal(taxableAmt * (taxRate.cgst / 100));
      const totalSGST = isIgst
        ? 0
        : toTwoDecimal(taxableAmt * (taxRate.sgst / 100));
      const igstRate = taxRate.igst || taxRate.cgst + taxRate.sgst;
      const totalIGST = isIgst
        ? toTwoDecimal(taxableAmt * (igstRate / 100))
        : 0;
      const netAmt = toTwoDecimal(
        taxableAmt + totalCGST + totalSGST + totalIGST,
      );

      recalculatedLineItems.push({
        ...item,
        totalCGST,
        totalSGST,
        totalIGST,
        netAmt,
      });
    }

    // Recompute order-level GST totals from the SERVER-recalculated line
    // items (not the client's) — this is what previously guarded only
    // against a stale/racy client-side isIGST flag at the header level;
    // now both the line items AND the header are server-authoritative.
    const computedCGST = toTwoDecimal(
      recalculatedLineItems.reduce(
        (sum, li) => sum + safeNumber(li.totalCGST),
        0,
      ),
    );
    const computedSGST = toTwoDecimal(
      recalculatedLineItems.reduce(
        (sum, li) => sum + safeNumber(li.totalSGST),
        0,
      ),
    );
    const computedIGST = toTwoDecimal(
      recalculatedLineItems.reduce(
        (sum, li) => sum + safeNumber(li.totalIGST),
        0,
      ),
    );

    // Add tax on freight/delivery/handling charges the same way the client
    // does, so the recomputed total still matches taxableAmount/netAmount
    // sent up.
    const additionalCharges =
      Number(freightCharges || 0) +
      Number(deliveryCharges || 0) +
      Number(handlingCharges || 0);

    const finalCGST = isIgst
      ? 0
      : Number((computedCGST + additionalCharges * 0.09).toFixed(2));
    const finalSGST = isIgst
      ? 0
      : Number((computedSGST + additionalCharges * 0.09).toFixed(2));
    const finalIGST = isIgst
      ? Number((computedIGST + additionalCharges * 0.18).toFixed(2))
      : 0;

    // Generate order number
    const orderNumber = await orderNumberGenerator("DBO");
    let finalManualOrderDate = new Date();

    if (manualOrderDate) {
      finalManualOrderDate = new Date(manualOrderDate);

      const now = new Date();

      finalManualOrderDate.setHours(
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds(),
      );
    }
    // Create the order entry object (not saved yet)
    const newOrderEntry = new OrderEntry({
      distributorId,
      orderNo: orderNumber,
      salesmanName,
      routeId,
      retailerId,
      cso: outlet?.cso ?? null,
      zoneId: outlet?.zoneId ?? null,
      orderType,
      orderSource,
      paymentMode,
      lineItems: recalculatedLineItems,
      remark: orderRemark,
      totalLines,
      manualOrderDate: finalManualOrderDate,
      freightCharges,
      deliveryCharges,
      shipToAddress,
      validity,
      deliveryTerms,
      deliverySchedule,
      paymentTerms,
      remarks,
      handlingCharges,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      cgst: finalCGST,
      sgst: finalSGST,
      igst: finalIGST,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      adjustedCreditNoteIds,
      creditAmount,
      cashDiscountApplied: req.body.cashDiscountApplied || false,
      cashDiscountType: req.body.cashDiscountType || "amount",
      cashDiscountValue: req.body.cashDiscountValue || 0,
    });

    // Determine if we should backdate the order createdAt (Distributor-only, 1st-2nd)
    // FIX: capture backdateResult outside try block so it is accessible after .save()
    let orderBackdateResult = null;
    try {
      const now = new Date();
      const billDeliverySetting = await BillDeliverySetting.findOne({
        distributorId,
        isActive: true,
      });
      const enableBackdate = billDeliverySetting
        ? billDeliverySetting.enableBackdateOrder
        : false;

      const backdateResult = getOrderBackdate(
        now,
        enableBackdate,
        orderSource,
        now,
      );

      if (backdateResult && backdateResult.isBackdated) {
        // set createdAt/updatedAt to backdate before saving
        newOrderEntry.createdAt = backdateResult.billDate;
        newOrderEntry.updatedAt = backdateResult.billDate;
        // attach metadata fields
        newOrderEntry._isBackdated = true;
        newOrderEntry._createdAtEpoch = backdateResult.billDate.getTime();

        // FIX: store result so we can apply post-save DB update below
        orderBackdateResult = backdateResult;
      }
    } catch (e) {
      // ignore backdate compute errors
      console.warn("BACKDATE_COMPUTE_ERROR on createOrderEntry:", e.message);
    }

    const savedOrderEntry = await newOrderEntry.save();

    // ─── FIX: Force backdated createdAt/updatedAt into DB after save ──────────
    // Mongoose { timestamps: true } silently overwrites createdAt on .save(),
    // so the in-memory assignment above is lost in the DB. This post-save update
    // ensures the correct backdated value is persisted, which is critical for the
    // fallback date path inside multipleBillCreate when _billDateEpoch is absent.
    if (orderBackdateResult && orderBackdateResult.isBackdated) {
      await OrderEntry.findByIdAndUpdate(savedOrderEntry._id, {
        createdAt: orderBackdateResult.billDate,
        updatedAt: orderBackdateResult.billDate,
      });
      // Keep the in-memory copy consistent so the bill creation payload below
      // also reflects the correct backdated timestamp.
      savedOrderEntry.createdAt = orderBackdateResult.billDate;
      savedOrderEntry.updatedAt = orderBackdateResult.billDate;
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (adjustedCreditNoteIds && adjustedCreditNoteIds.length > 0) {
      const creditNoteIds = adjustedCreditNoteIds.map(
        (item) => item.creditNoteId,
      );

      // Fetch all relevant credit notes
      const creditNotes = await CreditNoteModel.find({
        _id: { $in: creditNoteIds },
      });

      for (const creditNote of creditNotes) {
        const orderId = savedOrderEntry._id;

        const adjustedEntry = adjustedCreditNoteIds.find(
          (item) => String(item.creditNoteId) === String(creditNote._id),
        );

        if (!adjustedEntry) continue;

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;

        await CreditNoteModel.findByIdAndUpdate(
          creditNote._id,
          {
            $push: {
              adjustedBillIds: {
                orderId,
                adjustedAmount,
                type: "Order_To_Bill",
                collectionId: null,
              },
            },
          },
          { new: true },
        );

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

    let billData = null;
    let billError = null;

    if (savedOrderEntry && isBillCreate) {
      try {
        // Fetch the order entry details with population
        let orderEntryDetails = await OrderEntry.findById(savedOrderEntry._id)
          .populate([
            { path: "distributorId", select: "" },
            { path: "salesmanName", select: "" },
            { path: "routeId", select: "" },
            { path: "zoneId", select: "" },
            {
              path: "retailerId",
              select: "",
              populate: [
                {
                  path: "stateId",
                  select: "",
                  populate: {
                    path: "zoneId",
                    select: "",
                  },
                },
                { path: "regionId", select: "" },
                { path: "beatId", select: "" },
              ],
            },
            { path: "lineItems.product", select: "" },
            { path: "lineItems.price", select: "" },
            { path: "lineItems.inventoryId", select: "" },
            { path: "billIds", select: "" },
          ])
          .lean();

        if (!orderEntryDetails) {
          billError = "Order Entry not found for the created ID";
        } else {
          const authHeader = req.headers["authorization"];
          const bearerToken =
            authHeader && authHeader.startsWith("Bearer ")
              ? authHeader.split(" ")[1]
              : null;
          const token = req.cookies.DBToken || bearerToken;
          if (!token) {
            billError = "Authorization token is missing";
          } else {
            // Prepare data for bill creation
            orderEntryDetails = {
              ...orderEntryDetails,
              orderId: orderEntryDetails._id,
            };

            // Ensure createdAt is explicitly available as epoch to avoid
            // JSON serialization turning Date -> string and losing type info
            try {
              const createdAtDate = orderEntryDetails.manualOrderDate
                ? new Date(orderEntryDetails.manualOrderDate)
                : orderEntryDetails.createdAt instanceof Date
                  ? orderEntryDetails.createdAt
                  : new Date(orderEntryDetails.createdAt);
              orderEntryDetails.createdAt = createdAtDate;
              orderEntryDetails._createdAtEpoch = createdAtDate.getTime();

              // Compute backdate if distributor has backdate enabled
              try {
                const billDeliverySetting = await BillDeliverySetting.findOne(
                  {
                    distributorId,
                    isActive: true,
                  },
                );

                const backdateResult = getOrderBackdate(
                  createdAtDate,
                  billDeliverySetting
                    ? billDeliverySetting.enableBackdateOrder
                    : false,
                  orderEntryDetails.orderSource,
                  new Date(),
                );

                if (backdateResult && backdateResult.billDate) {
                  orderEntryDetails._billDateEpoch =
                    backdateResult.billDate.getTime();
                  orderEntryDetails._isBackdated = backdateResult.isBackdated;
                }
              } catch (e) {
                // ignore backdate computation errors
                console.warn(
                  "BACKDATE_COMPUTE_ERROR createOrderEntry",
                  e.message,
                );
              }
            } catch (e) {
              // ignore; leave as-is
            }

            const data = { data: [orderEntryDetails] };

            // Debug: show createdAt and epoch sent to bill creation
            console.log("BACKDATE_PAYLOAD createOrderEntry:", {
              orderId: orderEntryDetails._id,
              createdAt: orderEntryDetails.createdAt,
              _createdAtEpoch: orderEntryDetails._createdAtEpoch,
              _billDateEpoch: orderEntryDetails._billDateEpoch,
              _isBackdated: orderEntryDetails._isBackdated,
              orderSource: orderEntryDetails.orderSource,
            });

            // ─── After axios.post to /create-bulk-bill ────────────────────────────────

            const response = await axios.post(
              SERVER_URL + "/api/v3/bill/create-bulk-bill",
              data,
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
              },
            );

            billData = response.data;

            // ─── NEW: If bill was queued (async Redis path), poll until billIds populate ──
            // The queue worker processes bills asynchronously, so billIds on the order
            // won't be set yet when this response returns. Poll for up to 8s.
            if (billData?.jobId && !billData?.bills?.length) {
              const POLL_INTERVAL_MS = 800;
              const POLL_TIMEOUT_MS = 8000;
              const pollStart = Date.now();

              console.log(
                `⏳ Bill queued (jobId: ${billData.jobId}), polling order for billIds...`,
              );

              await new Promise((resolve) => {
                const poll = async () => {
                  try {
                    const updatedOrder = await OrderEntry.findById(
                      savedOrderEntry._id,
                    ).lean();

                    if (updatedOrder?.billIds?.length > 0) {
                      // Merge the populated billIds back so the response is useful
                      billData = {
                        ...billData,
                        bills: updatedOrder.billIds.map((id) => ({
                          _id: id,
                        })),
                        processedCount: updatedOrder.billIds.length,
                      };
                      savedOrderEntry.billIds = updatedOrder.billIds;
                      console.log(
                        `✅ billIds populated after ${Date.now() - pollStart}ms:`,
                        updatedOrder.billIds,
                      );
                      return resolve();
                    }

                    if (Date.now() - pollStart >= POLL_TIMEOUT_MS) {
                      console.warn(
                        `⚠️ Poll timeout after ${POLL_TIMEOUT_MS}ms — billIds still empty`,
                      );
                      return resolve();
                    }

                    setTimeout(poll, POLL_INTERVAL_MS);
                  } catch (e) {
                    console.warn("Poll error:", e.message);
                    resolve(); // don't block the response on poll errors
                  }
                };

                setTimeout(poll, POLL_INTERVAL_MS); // first check after initial delay
              });
            }
            // ─────────────────────────────────────────────────────────────────────────────

            if (response?.data?.skippedRows?.length > 0) {
              billError = "Bill creation partially failed with skipped rows";
            }

            // Update credit notes with billId after bill creation
            if (
              billData?.bills?.length > 0 &&
              adjustedCreditNoteIds &&
              adjustedCreditNoteIds.length > 0
            ) {
              const createdBill = billData.bills[0];
              const billId = createdBill._id;

              console.log(
                `✅ Updating credit notes with billId: ${billId} for orderId: ${savedOrderEntry._id}`,
              );

              // Update each credit note's adjustedBillIds entry
              for (const adjustedCN of adjustedCreditNoteIds) {
                const creditNoteId = adjustedCN.creditNoteId;

                // First, find the credit note to get its current state
                const creditNote =
                  await CreditNoteModel.findById(creditNoteId);

                if (creditNote) {
                  // Find the index of the entry that matches orderId and has no billId
                  const entryIndex = creditNote.adjustedBillIds.findIndex(
                    (entry) =>
                      String(entry.orderId) === String(savedOrderEntry._id) &&
                      (!entry.billId || entry.billId === null),
                  );

                  if (entryIndex !== -1) {
                    // Build the update path dynamically
                    const updatePath = `adjustedBillIds.${entryIndex}.billId`;

                    // Update using direct path instead of positional operator
                    const updateResult =
                      await CreditNoteModel.findByIdAndUpdate(
                        creditNoteId,
                        {
                          $set: {
                            [updatePath]: billId,
                          },
                        },
                        { new: true },
                      );

                    if (updateResult) {
                      console.log(
                        `✅ Successfully updated credit note ${creditNoteId} with billId ${billId} at index ${entryIndex}`,
                      );
                    } else {
                      console.warn(
                        `⚠️ Failed to update credit note ${creditNoteId}`,
                      );
                    }
                  } else {
                    console.warn(
                      `⚠️ No matching entry found in credit note ${creditNoteId} for orderId ${savedOrderEntry._id}`,
                    );
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error({
          error,
          message: error?.response?.data?.message || error?.message,
        });
        billError =
          "Order Entry created successfully, but Bill creation failed. " +
          (error?.response?.data?.message || error?.message);
      }
    }

    // Return appropriate response based on bill creation status
    if (billError) {
      return res.status(200).json({
        status: 200,
        message: "Order Entry created successfully",
        data: savedOrderEntry,
        billError,
        billData,
      });
    }

    res.status(200).json({
      status: 200,
      message: "Order Entry created successfully",
      data: savedOrderEntry,
      billData,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createOrderEntry };