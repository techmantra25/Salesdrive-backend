const asyncHandler = require("express-async-handler");

const OrderEntry = require("../../models/orderEntry.model");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OutletApproved = require("../../models/outletApproved.model");
const Price = require("../../models/price.model");

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
    } = req.body;

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
            // FIND ACTIVE PRICE
            // ==========================================

            let priceId = null;

            if (productId) {

                const activePrice =
                    await Price.findOne({
                        productId: productId,
                        status: true,
                    }).sort({ createdAt: -1 });

                priceId = activePrice?._id || null;
            }


            const inventoryId =
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

    // ==================================================
    // UPDATE ORDER
    // ==================================================

    existingOrder.salesmanName = salesmanName;
    existingOrder.routeId = routeId;
    existingOrder.retailerId = retailerId;

    existingOrder.paymentMode = paymentMode;
    existingOrder.orderType = orderType;

    existingOrder.lineItems = formattedLineItems;

    existingOrder.totalLines =
        Number(totalLines || 0);

    existingOrder.totalBasePoints =
        Number(totalBasePoints || 0);

    existingOrder.grossAmount =
        Number(grossAmount || 0);

    existingOrder.schemeDiscount =
        Number(schemeDiscount || 0);

    existingOrder.distributorDiscount =
        Number(distributorDiscount || 0);

    existingOrder.taxableAmount =
        Number(taxableAmount || 0);

    existingOrder.cgst =
        Number(cgst || 0);

    existingOrder.sgst =
        Number(sgst || 0);

    existingOrder.igst =
        Number(igst || 0);

    existingOrder.invoiceAmount =
        Number(invoiceAmount || 0);

    existingOrder.roundOffAmount =
        Number(roundOffAmount || 0);

    existingOrder.cashDiscount =
        Number(cashDiscount || 0);

    existingOrder.creditAmount =
        Number(creditAmount || 0);

    existingOrder.netAmount =
        Number(netAmount || 0);

    // ==================================================
    // SAVE
    // ==================================================

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