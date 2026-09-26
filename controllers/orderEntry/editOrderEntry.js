const asyncHandler = require("express-async-handler");

const OrderEntry = require("../../models/orderEntry.model");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OutletApproved = require("../../models/outletApproved.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");

// ─────────────────────────────────────────────────────────────────────────
// GST helpers — identical to createOrderEntry.controller.js. Move to a
// shared util and import from both places if you want a single copy.
// ─────────────────────────────────────────────────────────────────────────

const safeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const toTwoDecimal = (value) => Number(safeNumber(value).toFixed(2));

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
    return distributorState && retailerState && distributorState !== retailerState;
};

const getApplicableTaxRate = ({ product, taxableAmt, qty }) => {
    let cgst = safeNumber(product?.cgst);
    let sgst = safeNumber(product?.sgst);
    let igst = safeNumber(product?.igst);

    if (!cgst && !sgst && !igst) {
        cgst = 9;
        sgst = 9;
        igst = 18;
    }

    const taxablePricePerProduct = qty > 0 ? taxableAmt / qty : 0;

    if (taxablePricePerProduct >= 2500) {
        if (cgst === 2.5) cgst = 9;
        if (sgst === 2.5) sgst = 9;
        if (igst === 5) igst = 18;
    }

    return { cgst, sgst, igst };
};

// ─────────────────────────────────────────────────────────────────────────
// Builds the FROZEN price snapshot written onto the line item. This is what
// the order-detail page should render Base Rate / MRP / Std Disc% from —
// NOT a live populate() of the price reference, which can drift after a
// Price document is edited or reassigned post-save.
// ─────────────────────────────────────────────────────────────────────────

const buildPriceSnapshot = (priceDoc) => ({
    mrp_price: safeNumber(priceDoc?.mrp_price),
    rlp_price: safeNumber(priceDoc?.rlp_price),
    dlp_price: safeNumber(priceDoc?.dlp_price),
    L1DiscountPercentage: safeNumber(priceDoc?.L1DiscountPercentage),
    L2DiscountPercentage: safeNumber(priceDoc?.L2DiscountPercentage),
    price_type: priceDoc?.price_type || "",
    snapshotDate: new Date(),
});

const editOrderEntry = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const {
        salesmanName,
        routeId,
        retailerId,
        paymentMode,
        orderType,
        lineItems,
        creditAmount,

        remark,

        manualOrderDate,
        shipToAddress,
        validity,
        deliveryTerms,
        deliverySchedule,
        paymentTerms,
        remarks,

        freightCharges,
        handlingCharges,
    } = req.body;

    console.log("Edit Order Entry Request Body:", req.body);

    // ==================================================
    // FIND ORDER
    // ==================================================

    const existingOrder = await OrderEntry.findById(id);

    if (!existingOrder) {
        res.status(404);
        throw new Error("Order not found");
    }

    // ==================================================
    // ONLY PENDING / PARTIALLY BILLED EDITABLE
    // ==================================================

    if (
        existingOrder.status !== "Pending" &&
        existingOrder.status !== "Partially_Billed"
    ) {
        res.status(400);
        throw new Error("Only Pending / Partially Billed orders can be edited");
    }

    const retailerExists = await OutletApproved.findById(retailerId).populate(
        "stateId"
    );

    if (!retailerExists) {
        res.status(400);
        throw new Error("Retailer not found");
    }

    const distributor = await Distributor.findById(existingOrder.distributorId).populate(
        "stateId"
    );

    const isIGST = getIsIgst({ distributor, retailer: retailerExists });

    // ==================================================
    // LINE ITEMS
    // ==================================================
    // Price the client sends is trusted for WHICH price document applies
    // (date-based resolution already happened client-side, same as create).
    // This endpoint validates that product/price/inventory still exist,
    // guards against a zero-rate price, recomputes GST server-side, and —
    // NEW — writes a frozen priceSnapshot so the detail page never has to
    // live-populate the price reference again.

    const formattedLineItems = await Promise.all(
        (lineItems || []).map(async (item) => {
            const productId = item?.product?._id || item?.product || null;
            const priceId = item?.price?._id || item?.price || null;

            const product = await Product.findById(productId);
            if (!product) {
                throw new Error(`Product not found for ID ${productId}`);
            }

            const priceDoc = priceId ? await Price.findById(priceId) : null;
            if (!priceDoc) {
                throw new Error(`Price not found for ID ${priceId}`);
            }

            // Reject a zero/placeholder rate outright — never let a ₹0
            // price reach the saved order.
            if (!(Number(priceDoc.rlp_price) > 0)) {
                throw new Error(
                    `Price ${priceId} for product ${productId} has no valid rate (rlp_price is ${priceDoc.rlp_price}). Refusing to save with a zero price — pick a different date or fix this price record.`
                );
            }

            // ------------------------------------------
            // INVENTORY
            // ------------------------------------------
            let inventoryId =
                typeof item?.inventoryId === "object"
                    ? item?.inventoryId?._id ||
                      existingOrder?.lineItems?.find(
                          (li) => String(li?._id) === String(item?._id)
                      )?.inventoryId ||
                      null
                    : item?.inventoryId || null;

            if (!inventoryId && productId) {
                const inventory = await Inventory.findOne({
                    productId: productId,
                    distributorId: existingOrder.distributorId,
                });
                inventoryId = inventory?._id || null;
            }

            if (item?.inventoryId && typeof item.inventoryId !== "object") {
                const inventory = await Inventory.findById(item.inventoryId);
                if (!inventory) {
                    throw new Error(`Inventory not found for ID ${item.inventoryId}`);
                }
            }

            // ------------------------------------------
            // AMOUNTS
            // ------------------------------------------
            const qty = Number(item?.oderQty || 0);
            if (qty < 0) {
                throw new Error(`Negative quantity not allowed for product ${productId}`);
            }

            const grossAmt = Number(item?.grossAmt || 0);
            const taxableAmt = Number(item?.taxableAmt || 0);

            const mrpPrice = Number(priceDoc?.mrp_price || 0);
            const totalMrpAmount = mrpPrice * qty;
            const discountAmount = totalMrpAmount - taxableAmt;
            const totalDiscountPercentage =
                totalMrpAmount > 0
                    ? Number(((discountAmount / totalMrpAmount) * 100).toFixed(2))
                    : 0;

            // ------------------------------------------
            // TAX — recomputed server-side from Product.cgst/sgst/igst
            // ------------------------------------------
            const taxRate = getApplicableTaxRate({ product, taxableAmt, qty });

            const totalCGST = !isIGST
                ? toTwoDecimal(taxableAmt * (taxRate.cgst / 100))
                : 0;
            const totalSGST = !isIGST
                ? toTwoDecimal(taxableAmt * (taxRate.sgst / 100))
                : 0;
            const igstRate = taxRate.igst || taxRate.cgst + taxRate.sgst;
            const totalIGST = isIGST
                ? toTwoDecimal(taxableAmt * (igstRate / 100))
                : 0;

            const netAmt = toTwoDecimal(taxableAmt + totalCGST + totalSGST + totalIGST);

            return {
                product: productId,
                price: priceId,

                // FROZEN snapshot — the detail page renders MRP / Base Rate /
                // Std Disc% from THIS, not from populating `price` live.
                priceSnapshot: buildPriceSnapshot(priceDoc),

                inventoryId: inventoryId,

                uom: item?.uom || "pcs",
                goodsType: item?.goodsType || "Billed",

                oderQty: qty,
                boxOrderQty: Number(item?.boxOrderQty || 0),

                schemeDisc: Number(item?.schemeDisc || 0),
                distributorDisc: Number(item?.distributorDisc || 0),
                distributorDiscUnit: item?.distributorDiscUnit || "percent",
                totalDiscountPercentage,

                grossAmt,
                taxableAmt,

                totalCGST,
                totalSGST,
                totalIGST,

                netAmt,

                usedBasePoint: Number(item?.usedBasePoint || 0),
                billPrice: Number(item?.billPrice || 0),
            };
        })
    );

    // ======================================================
    // RECALCULATE TOTALS FROM LINE ITEMS
    // ======================================================

    const calculatedGrossAmount = formattedLineItems.reduce(
        (sum, item) => sum + Number(item.grossAmt || 0),
        0
    );

    const calculatedTaxableAmount = formattedLineItems.reduce(
        (sum, item) => sum + Number(item.taxableAmt || 0),
        0
    );

    const calculatedFreightCharges = Number(freightCharges || 0);
    const calculatedHandlingCharges = Number(handlingCharges || 0);
    const additionalCharges = calculatedFreightCharges + calculatedHandlingCharges;

    const itemsCGST = formattedLineItems.reduce((s, i) => s + Number(i.totalCGST || 0), 0);
    const itemsSGST = formattedLineItems.reduce((s, i) => s + Number(i.totalSGST || 0), 0);
    const itemsIGST = formattedLineItems.reduce((s, i) => s + Number(i.totalIGST || 0), 0);

    const chargeCGST = !isIGST ? Number((additionalCharges * 0.09).toFixed(2)) : 0;
    const chargeSGST = !isIGST ? Number((additionalCharges * 0.09).toFixed(2)) : 0;
    const chargeIGST = isIGST ? Number((additionalCharges * 0.18).toFixed(2)) : 0;

    const calculatedCGST = Number((itemsCGST + chargeCGST).toFixed(2));
    const calculatedSGST = Number((itemsSGST + chargeSGST).toFixed(2));
    const calculatedIGST = Number((itemsIGST + chargeIGST).toFixed(2));

    const gstTaxableAmount = calculatedTaxableAmount + additionalCharges;

    const calculatedDiscount = formattedLineItems.reduce(
        (sum, item) => sum + (Number(item.grossAmt || 0) - Number(item.taxableAmt || 0)),
        0
    );

    const calculatedInvoiceAmount =
        calculatedTaxableAmount +
        additionalCharges +
        calculatedCGST +
        calculatedSGST +
        calculatedIGST;

    const calculatedRoundOffAmount = Math.round(calculatedInvoiceAmount);
    const calculatedCreditAmount = Number(creditAmount || 0);
    const calculatedNetAmount = calculatedRoundOffAmount - calculatedCreditAmount;

    const calculatedTotalBasePoints = formattedLineItems.reduce(
        (sum, item) => sum + Number(item.usedBasePoint || 0),
        0
    );

    // ==================================================
    // UPDATE ORDER
    // ==================================================
    existingOrder.salesmanName = salesmanName;
    existingOrder.routeId = routeId;
    existingOrder.retailerId = retailerId;

    existingOrder.paymentMode = paymentMode;
    existingOrder.orderType = orderType;

    existingOrder.lineItems = formattedLineItems;
    existingOrder.totalLines = formattedLineItems.length;

    existingOrder.totalBasePoints = calculatedTotalBasePoints;
    existingOrder.grossAmount = Number(calculatedGrossAmount.toFixed(2));

    existingOrder.distributorDiscount = Number(calculatedDiscount.toFixed(2));
    existingOrder.freightCharges = calculatedFreightCharges;
    existingOrder.handlingCharges = calculatedHandlingCharges;

    existingOrder.taxableAmount = Number(gstTaxableAmount.toFixed(2));
    existingOrder.cgst = calculatedCGST;
    existingOrder.sgst = calculatedSGST;
    existingOrder.igst = calculatedIGST;

    existingOrder.invoiceAmount = Number(calculatedInvoiceAmount.toFixed(2));
    existingOrder.roundOffAmount = calculatedRoundOffAmount;
    existingOrder.creditAmount = calculatedCreditAmount;
    existingOrder.netAmount = Number(calculatedNetAmount.toFixed(2));

    existingOrder.remark = remark || "";

    existingOrder.manualOrderDate = manualOrderDate || existingOrder.manualOrderDate;
    existingOrder.shipToAddress = shipToAddress || "";
    existingOrder.validity = validity || "";
    existingOrder.deliveryTerms = deliveryTerms || "";
    existingOrder.deliverySchedule = deliverySchedule || "";
    existingOrder.paymentTerms = paymentTerms || "";
    existingOrder.remarks = remarks || "";

    // ==================================================
    // SAVE
    // ==================================================

    const updatedOrder = await existingOrder.save();

    // ==================================================
    // UPDATE SECONDARY LOG
    // ==================================================

    if (updatedOrder?.secondaryOrderEntryLogId) {
        await SecondaryOrderEntryLog.findByIdAndUpdate(updatedOrder.secondaryOrderEntryLogId, {
            $set: { updatedOrderId: updatedOrder._id },
        });
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    res.status(200).json({
        success: true,
        message: "Order updated successfully",
        data: updatedOrder,
    });
});

module.exports = {
    editOrderEntry,
    buildPriceSnapshot, // exported so createOrderEntry can reuse the same builder
};

