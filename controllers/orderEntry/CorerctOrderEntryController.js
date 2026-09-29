const mongoose = require("mongoose");
const OrderEntry = require("../../models/orderEntry.model");

// ============================================================
// HELPERS
// ============================================================

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value) => {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
};

// Compare money/number values with 0.01 tolerance
const isDifferent = (stored, calculated) => {
  return (
    Math.abs(
      round2(stored) - round2(calculated)
    ) > 0.01
  );
};

// ============================================================
// GST RATE
// ============================================================

const getExistingGstRates = (item) => {
  const oldTaxable = num(item.taxableAmt);

  if (oldTaxable <= 0) {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: 0,
    };
  }

  return {
    cgstRate: round2(
      (num(item.totalCGST) / oldTaxable) * 100
    ),

    sgstRate: round2(
      (num(item.totalSGST) / oldTaxable) * 100
    ),

    igstRate: round2(
      (num(item.totalIGST) / oldTaxable) * 100
    ),
  };
};

// ============================================================
// RECALCULATE ORDER ENTRY
// ============================================================

exports.recalculateOrderEntry = async (req, res) => {
  try {
    const { orderEntryId } = req.params;
    console.log("🔄 RECALCULATE API CALLED | orderEntryId:", orderEntryId);

    // ========================================================
    // VALIDATE ID
    // ========================================================

    if (!mongoose.Types.ObjectId.isValid(orderEntryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order entry ID",
      });
    }

    // ========================================================
    // FIND ORDER ENTRY
    // ========================================================

    const orderEntry = await OrderEntry.findById(
      orderEntryId
    );

    if (!orderEntry) {
      return res.status(404).json({
        success: false,
        message: "Order entry not found",
      });
    }

    // ========================================================
    // TOTALS
    // ========================================================

    let totalGrossAmount = 0;
    let totalSchemeDiscount = 0;
    let totalDistributorDiscount = 0;
    let totalTaxableAmount = 0;

    let totalItemCGST = 0;
    let totalItemSGST = 0;
    let totalItemIGST = 0;

    let totalLineNetAmount = 0;

    let hasMismatch = false;

    const mismatches = [];

    // ========================================================
    // RECALCULATE LINE ITEMS
    // ========================================================

    const calculatedLineItems =
      (orderEntry.lineItems || []).map(
        (item, index) => {

          // ----------------------------------------------------
          // GROSS
          // ----------------------------------------------------

          const grossAmount = round2(
            num(item.grossAmt)
          );

          // ----------------------------------------------------
          // SCHEME DISCOUNT
          // ----------------------------------------------------

          const schemeDiscount = round2(
            num(item.schemeDisc)
          );

          // ----------------------------------------------------
          // DISTRIBUTOR DISCOUNT
          // ----------------------------------------------------

          const distributorDiscUnit =
            String(
              item.distributorDiscUnit ||
                "amount"
            ).toLowerCase();

          let distributorDiscount =
            round2(
              num(item.distributorDisc)
            );

          // If stored as percentage
          if (
            distributorDiscUnit === "percent" ||
            distributorDiscUnit === "percentage" ||
            distributorDiscUnit === "%"
          ) {
            distributorDiscount = round2(
              (grossAmount *
                num(item.distributorDisc)) /
                100
            );
          }

          // ----------------------------------------------------
          // TOTAL DISCOUNT
          // ----------------------------------------------------

          const totalLineDiscount = round2(
            schemeDiscount +
              distributorDiscount
          );

          // ----------------------------------------------------
          // TAXABLE
          // ----------------------------------------------------

          const taxableAmount = round2(
            Math.max(
              0,
              grossAmount -
                totalLineDiscount
            )
          );

          // ----------------------------------------------------
          // GST RATE
          // ----------------------------------------------------

          const gstRates =
            getExistingGstRates(item);

          // ----------------------------------------------------
          // GST
          // ----------------------------------------------------

          let cgst = 0;
          let sgst = 0;
          let igst = 0;

          if (taxableAmount > 0) {

            cgst = round2(
              (taxableAmount *
                gstRates.cgstRate) /
                100
            );

            sgst = round2(
              (taxableAmount *
                gstRates.sgstRate) /
                100
            );

            igst = round2(
              (taxableAmount *
                gstRates.igstRate) /
                100
            );
          }

          // ----------------------------------------------------
          // LINE NET
          // ----------------------------------------------------

          const netAmount = round2(
            taxableAmount +
              cgst +
              sgst +
              igst
          );

          // ----------------------------------------------------
          // TOTALS
          // ----------------------------------------------------

          totalGrossAmount += grossAmount;

          totalSchemeDiscount +=
            schemeDiscount;

          totalDistributorDiscount +=
            distributorDiscount;

          totalTaxableAmount +=
            taxableAmount;

          totalItemCGST += cgst;
          totalItemSGST += sgst;
          totalItemIGST += igst;

          totalLineNetAmount +=
            netAmount;

          // ----------------------------------------------------
          // CHECK LINE ITEM MISMATCH
          // ----------------------------------------------------

          const lineFields = [
            {
              field: "grossAmt",
              stored: item.grossAmt,
              calculated: grossAmount,
            },

            {
              field: "schemeDisc",
              stored: item.schemeDisc,
              calculated: schemeDiscount,
            },

            {
              field: "distributorDisc",
              stored:
                distributorDiscUnit ===
                  "percent" ||
                distributorDiscUnit ===
                  "percentage" ||
                distributorDiscUnit === "%"
                  ? distributorDiscount
                  : item.distributorDisc,
              calculated:
                distributorDiscount,
            },

            {
              field: "taxableAmt",
              stored: item.taxableAmt,
              calculated: taxableAmount,
            },

            {
              field: "totalCGST",
              stored: item.totalCGST,
              calculated: cgst,
            },

            {
              field: "totalSGST",
              stored: item.totalSGST,
              calculated: sgst,
            },

            {
              field: "totalIGST",
              stored: item.totalIGST,
              calculated: igst,
            },

            {
              field: "netAmt",
              stored: item.netAmt,
              calculated: netAmount,
            },
          ];

          lineFields.forEach(
            ({
              field,
              stored,
              calculated,
            }) => {

              if (
                isDifferent(
                  stored,
                  calculated
                )
              ) {

                hasMismatch = true;

                mismatches.push({
                  type: "lineItem",
                  lineIndex: index,
                  product: item.product,
                  field,
                  stored: round2(
                    stored
                  ),
                  calculated,
                    calculated,
                  difference: round2(
                    num(stored) -
                      calculated
                  ),
                });
              }
            }
          );

          // ----------------------------------------------------
          // RETURN CALCULATED ITEM
          // ----------------------------------------------------

          return {
            ...item.toObject
              ? item.toObject()
              : item,

            grossAmt:
              grossAmount,

            schemeDisc:
              schemeDiscount,

            // Important:
            // Store actual amount after correction
            distributorDisc:
              distributorDiscount,

            taxableAmt:
              taxableAmount,

            totalCGST:
              cgst,

            totalSGST:
              sgst,

            totalIGST:
              igst,

            netAmt:
              netAmount,

            totalDiscountAmount:
              totalLineDiscount,

            // Preserve original percentage
            totalDiscountPercentage:
              item.totalDiscountPercentage,
          };
        }
      );

    // ========================================================
    // ROUND TOTALS
    // ========================================================

    totalGrossAmount =
      round2(totalGrossAmount);

    totalSchemeDiscount =
      round2(totalSchemeDiscount);

    totalDistributorDiscount =
      round2(totalDistributorDiscount);

    totalTaxableAmount =
      round2(totalTaxableAmount);

    totalItemCGST =
      round2(totalItemCGST);

    totalItemSGST =
      round2(totalItemSGST);

    totalItemIGST =
      round2(totalItemIGST);

    totalLineNetAmount =
      round2(totalLineNetAmount);

    // ========================================================
    // CHARGES
    // ========================================================

    const freightCharges = round2(
      num(orderEntry.freightCharges)
    );

    const deliveryCharges = round2(
      num(orderEntry.deliveryCharges)
    );

    const handlingCharges = round2(
      num(orderEntry.handlingCharges)
    );

    // ========================================================
    // CHARGE GST
    // ========================================================

    const FREIGHT_GST_RATE = 18;
    const DELIVERY_GST_RATE = 18;
    const HANDLING_GST_RATE = 18;

    const freightGST = round2(
      (freightCharges *
        FREIGHT_GST_RATE) /
        100
    );

    const deliveryGST = round2(
      (deliveryCharges *
        DELIVERY_GST_RATE) /
        100
    );

    const handlingGST = round2(
      (handlingCharges *
        HANDLING_GST_RATE) /
        100
    );

    const totalChargesGST = round2(
      freightGST +
        deliveryGST +
        handlingGST
    );

    // ========================================================
    // GST SPLIT
    // ========================================================

    let chargeCGST = 0;
    let chargeSGST = 0;
    let chargeIGST = 0;

    if (num(orderEntry.igst) > 0) {

      chargeIGST =
        totalChargesGST;

    } else {

      chargeCGST = round2(
        totalChargesGST / 2
      );

      chargeSGST = round2(
        totalChargesGST / 2
      );
    }

    // ========================================================
    // FINAL TAXABLE
    // ========================================================

    const finalTaxableAmount =
      round2(
        totalTaxableAmount +
          freightCharges +
          deliveryCharges +
          handlingCharges
      );

    // ========================================================
    // FINAL GST
    // ========================================================

    const finalCGST = round2(
      totalItemCGST +
        chargeCGST
    );

    const finalSGST = round2(
      totalItemSGST +
        chargeSGST
    );

    const finalIGST = round2(
      totalItemIGST +
        chargeIGST
    );

    const finalGST = round2(
      finalCGST +
        finalSGST +
        finalIGST
    );

    // ========================================================
    // INVOICE AMOUNT
    // ========================================================

    const invoiceAmount = round2(
      finalTaxableAmount +
        finalGST
    );

    // ========================================================
    // ROUND OFF
    // ========================================================

    const roundOffAmount = 0;

    // ========================================================
    // CASH DISCOUNT
    // ========================================================

    const cashDiscount = round2(
      num(orderEntry.cashDiscount)
    );

    // ========================================================
    // FINAL NET
    // ========================================================

    const finalNetAmount = round2(
      invoiceAmount +
        roundOffAmount -
        cashDiscount
    );

    // ========================================================
    // TOTAL LINES
    // ========================================================

    const totalLines =
      calculatedLineItems.filter(
        (item) =>
          num(item.oderQty) > 0 ||
          num(item.netAmt) > 0
      ).length;

    // ========================================================
    // CHECK HEADER VALUES
    // ========================================================

    const headerFields = [
      {
        field: "totalLines",
        stored: orderEntry.totalLines,
        calculated: totalLines,
      },

      {
        field: "grossAmount",
        stored: orderEntry.grossAmount,
        calculated: totalGrossAmount,
      },

      {
        field: "schemeDiscount",
        stored:
          orderEntry.schemeDiscount,
        calculated:
          totalSchemeDiscount,
      },

      {
        field: "distributorDiscount",
        stored:
          orderEntry.distributorDiscount,
        calculated:
          totalDistributorDiscount,
      },

      {
        field: "taxableAmount",
        stored:
          orderEntry.taxableAmount,
        calculated:
          finalTaxableAmount,
      },

      {
        field: "cgst",
        stored: orderEntry.cgst,
        calculated: finalCGST,
      },

      {
        field: "sgst",
        stored: orderEntry.sgst,
        calculated: finalSGST,
      },

      {
        field: "igst",
        stored: orderEntry.igst,
        calculated: finalIGST,
      },

      {
        field: "invoiceAmount",
        stored:
          orderEntry.invoiceAmount,
        calculated:
          invoiceAmount,
      },

      {
        field: "roundOffAmount",
        stored:
          orderEntry.roundOffAmount,
        calculated:
          roundOffAmount,
      },

      {
        field: "netAmount",
        stored:
          orderEntry.netAmount,
        calculated:
          finalNetAmount,
      },
    ];

    headerFields.forEach(
      ({
        field,
        stored,
        calculated,
      }) => {

        if (
          isDifferent(
            stored,
            calculated
          )
        ) {

          hasMismatch = true;

          mismatches.push({
            type: "header",
            field,
            stored: round2(stored),
            calculated,
            difference: round2(
              num(stored) -
                calculated
            ),
          });
        }
      }
    );

    // ========================================================
    // IMPORTANT
    //
    // IF EVERYTHING IS CORRECT:
    // DO NOT UPDATE DATABASE
    // ========================================================

    if (!hasMismatch) {
        console.log("✅ RECALCULATE: already correct, no DB update | orderNo:", orderEntry.orderNo);

      return res.status(200).json({
        success: true,
        corrected: false,
        isMismatch: false,

        message:
          "Order entry calculation is already correct",

        data: {
          orderEntryId:
            orderEntry._id,

          orderNo:
            orderEntry.orderNo,

          totalLines,

          netAmount:
            finalNetAmount,
        },
      });
    }

    // ========================================================
    // MISMATCH FOUND
    //
    // NOW UPDATE DATABASE
    // ========================================================

    orderEntry.lineItems =
      calculatedLineItems;

    orderEntry.totalLines =
      totalLines;

    orderEntry.grossAmount =
      totalGrossAmount;

    orderEntry.schemeDiscount =
      totalSchemeDiscount;

    orderEntry.distributorDiscount =
      totalDistributorDiscount;

    orderEntry.taxableAmount =
      finalTaxableAmount;

    orderEntry.cgst =
      finalCGST;

    orderEntry.sgst =
      finalSGST;

    orderEntry.igst =
      finalIGST;

    orderEntry.freightCharges =
      freightCharges;

    orderEntry.deliveryCharges =
      deliveryCharges;

    orderEntry.handlingCharges =
      handlingCharges;

    orderEntry.invoiceAmount =
      invoiceAmount;

    orderEntry.roundOffAmount =
      roundOffAmount;

    orderEntry.netAmount =
      finalNetAmount;

    orderEntry.updatedAt =
      new Date();

    await orderEntry.save();
        console.log(
      `⚠️ RECALCULATE: ${mismatches.length} mismatch(es) found for orderNo ${orderEntry.orderNo}, updating DB`,
    );
    console.log("RECALCULATE MISMATCHES:", JSON.stringify(mismatches, null, 2));

    await orderEntry.save();

    console.log("💾 RECALCULATE: order corrected and saved | orderNo:", orderEntry.orderNo);

    // ========================================================
    // RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      corrected: true,

      isMismatch: true,

      message:
        "Order entry calculation mismatch found and corrected",

      data: {
        orderEntryId:
          orderEntry._id,

        orderNo:
          orderEntry.orderNo,

        totalLines,

        grossAmount:
          totalGrossAmount,

        taxableAmount:
          finalTaxableAmount,

        cgst:
          finalCGST,

        sgst:
          finalSGST,

        igst:
          finalIGST,

        invoiceAmount,

        roundOffAmount,

        cashDiscount,

        netAmount:
          finalNetAmount,

        mismatchCount:
          mismatches.length,

        mismatches,
      },
    });

  } catch (error) {

    console.error(
      "RECALCULATE ORDER ENTRY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to recalculate order entry",
      error: error.message,
    });
  }
};