const asyncHandler = require("express-async-handler");

const OrderEntry = require("../../models/orderEntry.model");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OutletApproved = require("../../models/outletApproved.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");

const editOrderEntry = asyncHandler(async (req, res) => {
    const { id } = req.params;

   const {
    salesmanName,
    routeId,
    retailerId,
    paymentMode,
    orderType,
    lineItems,
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
    creditAmount,
    netAmount,
    totalBasePoints,
    totalLines,

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

    console.log("All Body in Backend", req.body);

    // ==================================================
    // FIND ORDER
    // ==================================================

    const existingOrder = await OrderEntry.findById(id);

    if (!existingOrder) {
        res.status(404);
        throw new Error("Order not found");
    }

    // ==================================================
    // ONLY PENDING EDITABLE
    // ==================================================

    if (
        existingOrder.status !== "Pending" &&
        existingOrder.status !== "Partially_Billed"
    ) {
        res.status(400);
        throw new Error(
            "Only Pending / Partially Billed orders can be edited"
        );
    }

    const retailerExists = await OutletApproved.findById(
        retailerId
    );

    if (!retailerExists) {
        res.status(400);
        throw new Error("Retailer not found");
    }

    const formattedLineItems = await Promise.all(
        (lineItems || []).map(async (item) => {

            // ==========================================
            // PRODUCT ID
            // ==========================================

                    const productId =
                item?.product?._id ||
                item?.product ||
                null;

            // ==========================================
            // PRESERVE ORIGINAL PRICE FROM LINE ITEM
            // ==========================================

            const priceId =
                item?.price?._id ||
                item?.price ||
                null;


            let inventoryId =
                typeof item?.inventoryId === "object"
                    ? (
                        item?.inventoryId?._id ||

                        existingOrder?.lineItems?.find(
                            (li) =>
                                String(li?._id) ===
                                String(item?._id)
                        )?.inventoryId ||

                        null
                    )
                    : item?.inventoryId || null;


            // ==========================================
            // AUTO FIND INVENTORY IF NULL
            // ==========================================

            if (!inventoryId && productId) {

                const inventory =
                    await Inventory.findOne({
                        productId: productId,
                        distributorId:
                            existingOrder.distributorId,
                    });

                inventoryId = inventory?._id || null;

                console.log(
                    "AUTO INVENTORY",
                    productId,
                    inventoryId
                );
            }


            const grossAmt =
                Number(item?.grossAmt || 0);

            const taxableAmt =
                Number(item?.taxableAmt || 0);


            let priceDoc = null;

            if (priceId) {
                priceDoc = await Price.findById(
                    priceId
                );
            }

            const mrpPrice = Number(
                priceDoc?.mrp_price || 0
            );

            const orderQty = Number(
                item?.oderQty || 0
            );

            const totalMrpAmount =
                mrpPrice * orderQty;

            const discountAmount =
                totalMrpAmount - taxableAmt;

            const totalDiscountPercentage =
                totalMrpAmount > 0
                    ? Number(
                        (
                            (
                                discountAmount /
                                totalMrpAmount
                            ) * 100
                        ).toFixed(2)
                    )
                    : 0;

            return {

                // ======================================
                // IDS
                // ======================================

                product: productId,

                price: priceId,

                inventoryId: inventoryId,

                // ======================================
                // BASIC
                // ======================================

                uom: item?.uom || "pcs",

                goodsType:
                    item?.goodsType || "Billed",

                // ======================================
                // QUANTITY
                // ======================================

                oderQty:
                    Number(item?.oderQty || 0),

                boxOrderQty:
                    Number(item?.boxOrderQty || 0),

                // ======================================
                // DISCOUNT
                // ======================================

                schemeDisc:
                    Number(item?.schemeDisc || 0),

                distributorDisc:
                    Number(item?.distributorDisc || 0),

                distributorDiscUnit:
                    item?.distributorDiscUnit ||
                    "percent",

                totalDiscountPercentage,

                // ======================================
                // AMOUNTS
                // ======================================

                grossAmt,

                taxableAmt,

                totalCGST:
                    Number(item?.totalCGST || 0),

                totalSGST:
                    Number(item?.totalSGST || 0),

                totalIGST:
                    Number(item?.totalIGST || 0),

                netAmt:
                    Number(item?.netAmt || 0),

                // ======================================
                // EXTRA
                // ======================================

                usedBasePoint:
                    Number(item?.usedBasePoint || 0),

                billPrice:
                    Number(item?.billPrice || 0),
            };
        })
    );
    // ======================================
    // RECALCULATE TOTALS FROM LINE ITEMS
    // ======================================

    const calculatedGrossAmount = formattedLineItems.reduce(
        (sum, item) => sum + Number(item.grossAmt || 0),
        0
    );

    const calculatedTaxableAmount = formattedLineItems.reduce(
        (sum, item) => sum + Number(item.taxableAmt || 0),
        0
    );

    // Charges
    const calculatedFreightCharges =
        Number(freightCharges || 0);


    const calculatedHandlingCharges =
        Number(handlingCharges || 0);

    // GST Taxable Value
    const gstTaxableAmount =
        calculatedTaxableAmount +
        calculatedFreightCharges +
        calculatedHandlingCharges;

    // Detect GST Type
    const isIGST = formattedLineItems.some(
        (item) => Number(item.totalIGST || 0) > 0
    );

    // GST %
    let gstPercentage = 18;

    const firstLine = formattedLineItems[0];

    if (firstLine?.taxableAmt > 0) {
        const lineGST =
            Number(firstLine.totalCGST || 0) +
            Number(firstLine.totalSGST || 0) +
            Number(firstLine.totalIGST || 0);

        gstPercentage =
            Number(
                ((lineGST / Number(firstLine.taxableAmt)) * 100).toFixed(2)
            ) || 18;
    }

    // Recalculate GST on Taxable + Charges
    let calculatedCGST = 0;
    let calculatedSGST = 0;
    let calculatedIGST = 0;

    const totalGST =
        Number(
            ((gstTaxableAmount * gstPercentage) / 100).toFixed(2)
        );

    if (isIGST) {
        calculatedIGST = totalGST;
    } else {
        calculatedCGST = Number((totalGST / 2).toFixed(2));
        calculatedSGST = Number((totalGST / 2).toFixed(2));
    }

    // Total discount amount
    const calculatedDiscount = formattedLineItems.reduce(
        (sum, item) =>
            sum +
            (
                (Number(item.grossAmt || 0) -
                    Number(item.taxableAmt || 0))
            ),
        0
    );



    // Invoice Amount
    const calculatedInvoiceAmount =
        calculatedTaxableAmount +
        calculatedFreightCharges +
        calculatedHandlingCharges +
        calculatedCGST +
        calculatedSGST +
        calculatedIGST;

    // Round Off
    const calculatedRoundOffAmount =
        Math.round(calculatedInvoiceAmount);

    // Credit
    const calculatedCreditAmount =
        Number(creditAmount || 0);

    // Net Amount
    const calculatedNetAmount =
        calculatedRoundOffAmount -
        calculatedCreditAmount;
    // ==================================================
    // UPDATE ORDER
    // ==================================================
    existingOrder.salesmanName = salesmanName;
    existingOrder.routeId = routeId;
    existingOrder.retailerId = retailerId;

    existingOrder.paymentMode = paymentMode;
    existingOrder.orderType = orderType;

    // VERY IMPORTANT
    existingOrder.lineItems = formattedLineItems;

    existingOrder.totalLines = formattedLineItems.length;

    existingOrder.totalBasePoints =
        Number(totalBasePoints || 0);
    existingOrder.grossAmount =
        Number(calculatedGrossAmount.toFixed(2));

    existingOrder.distributorDiscount =
        Number(calculatedDiscount.toFixed(2));
    existingOrder.freightCharges =
        calculatedFreightCharges;


    existingOrder.handlingCharges =
        calculatedHandlingCharges;

    existingOrder.taxableAmount =
        Number(gstTaxableAmount.toFixed(2));

    existingOrder.cgst =
        Number(calculatedCGST.toFixed(2));

    existingOrder.sgst =
        Number(calculatedSGST.toFixed(2));

    existingOrder.igst =
        Number(calculatedIGST.toFixed(2));

    existingOrder.invoiceAmount =
        Number(calculatedInvoiceAmount.toFixed(2));

    existingOrder.roundOffAmount =
        calculatedRoundOffAmount;

    existingOrder.creditAmount =
        calculatedCreditAmount;

    existingOrder.netAmount =
        Number(calculatedNetAmount.toFixed(2));
        
        existingOrder.remark = remark || "";
    // ==================================================
    // SAVE
    // ==================================================
// Order Details
existingOrder.manualOrderDate =
    manualOrderDate || existingOrder.manualOrderDate;

existingOrder.shipToAddress =
    shipToAddress || "";

existingOrder.validity =
    validity || "";

existingOrder.deliveryTerms =
    deliveryTerms || "";

existingOrder.deliverySchedule =
    deliverySchedule || "";

existingOrder.paymentTerms =
    paymentTerms || "";

existingOrder.remarks =
    remarks || "";
    const updatedOrder =
        await existingOrder.save();

    // ==================================================
    // UPDATE SECONDARY LOG
    // ==================================================

    if (
        updatedOrder?.secondaryOrderEntryLogId
    ) {
        await SecondaryOrderEntryLog.findByIdAndUpdate(
            updatedOrder.secondaryOrderEntryLogId,
            {
                $set: {
                    updatedOrderId:
                        updatedOrder._id,
                },
            }
        );
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    res.status(200).json({
        success: true,
        message:
            "Order updated successfully",
        data: updatedOrder,
    });
});

module.exports = {
    editOrderEntry,
};