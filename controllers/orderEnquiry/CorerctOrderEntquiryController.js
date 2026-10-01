const mongoose = require("mongoose");
// TODO: adjust to your actual Order Enquiry model file/name
const OrderEnquiry = require("../../models/orderEnquiry.model");

// ============================================================
// HELPERS
// ============================================================

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Same rounding as createOrderEntry (toFixed), so a recalculation reproduces
// the values that were stored at creation instead of drifting by a paisa on
// half-paisa cases (e.g. 33.345 -> 33.34, not 33.35).
const round2 = (value) => Number(num(value).toFixed(2));

// Compare in whole paise and tolerate a 1 paisa difference. Comparing
// decimals with "> 0.01" can misfire because of floating point noise.
const isDifferent = (stored, calculated) =>
  Math.abs(Math.round(num(stored) * 100) - Math.round(num(calculated) * 100)) >
  1;

// ============================================================
// GST RATE (taken from what is already stored on the line)
// ============================================================

const getExistingGstRates = (item) => {
  const oldTaxable = num(item.taxableAmt);

  if (oldTaxable <= 0) {
    return { cgstRate: 0, sgstRate: 0, igstRate: 0 };
  }

  return {
    cgstRate: round2((num(item.totalCGST) / oldTaxable) * 100),
    sgstRate: round2((num(item.totalSGST) / oldTaxable) * 100),
    igstRate: round2((num(item.totalIGST) / oldTaxable) * 100),
  };
};

const isPercentUnit = (unit) => {
  const u = String(unit || "amount").toLowerCase();
  return u === "percent" || u === "percentage" || u === "%";
};

// ============================================================
// RECALCULATE ORDER ENQUIRY
// ============================================================


exports.recalculateOrderEnquiry = async (req, res) => {
  try {
    const { enquiryId } = req.params;
   

    // --------------------------------------------------------
    // VALIDATE ID
    // --------------------------------------------------------
    if (!mongoose.Types.ObjectId.isValid(enquiryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order enquiry ID",
      });
    }



const enquiry = await OrderEnquiry.findById(enquiryId);



    if (!enquiry) {
      return res.status(404).json({
        success: false,
        message: "Order enquiry not found",
      });
    }

    // --------------------------------------------------------
    // TOTALS
    // --------------------------------------------------------
    let totalGrossAmount = 0;
    let totalSchemeDiscount = 0;
    let totalDistributorDiscount = 0;
    let totalTaxableAmount = 0;

    let totalItemCGST = 0;
    let totalItemSGST = 0;
    let totalItemIGST = 0;

    let hasMismatch = false;
    const mismatches = [];

    // --------------------------------------------------------
    // RECALCULATE LINE ITEMS
    // --------------------------------------------------------
    const calculatedLineItems = (enquiry.lineItems || []).map((item, index) => {
      const plain = item.toObject ? item.toObject() : item;

      // grossAmt is an input (already the price x qty after MRP discount)
      const grossAmount = round2(item.grossAmt);
      const schemeDiscount = round2(item.schemeDisc);

      // distributorDisc can be an amount or a percentage of gross
      const distributorDiscount = isPercentUnit(item.distributorDiscUnit)
        ? round2((grossAmount * num(item.distributorDisc)) / 100)
        : round2(item.distributorDisc);

      const taxableAmount = round2(
        Math.max(0, grossAmount - schemeDiscount - distributorDiscount),
      );

      const gstRates = getExistingGstRates(item);

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (taxableAmount > 0) {
        cgst = round2(taxableAmount * (gstRates.cgstRate / 100));
        sgst = round2(taxableAmount * (gstRates.sgstRate / 100));
        igst = round2(taxableAmount * (gstRates.igstRate / 100));
      }

      const netAmount = round2(taxableAmount + cgst + sgst + igst);

      // header totals
      totalGrossAmount += grossAmount;
      totalSchemeDiscount += schemeDiscount;
      totalDistributorDiscount += distributorDiscount;
      totalTaxableAmount += taxableAmount;
      totalItemCGST += cgst;
      totalItemSGST += sgst;
      totalItemIGST += igst;

      // only the DERIVED fields are checked / overwritten
      const lineFields = [
        { field: "taxableAmt", stored: item.taxableAmt, calculated: taxableAmount },
        { field: "totalCGST", stored: item.totalCGST, calculated: cgst },
        { field: "totalSGST", stored: item.totalSGST, calculated: sgst },
        { field: "totalIGST", stored: item.totalIGST, calculated: igst },
        { field: "netAmt", stored: item.netAmt, calculated: netAmount },
      ];

      lineFields.forEach(({ field, stored, calculated }) => {
        if (isDifferent(stored, calculated)) {
          hasMismatch = true;
          mismatches.push({
            type: "lineItem",
            lineIndex: index,
            product: item.product,
            field,
            stored: round2(stored),
            calculated,
            difference: round2(num(stored) - calculated),
          });
        }
      });

      // NOTE: grossAmt, schemeDisc, distributorDisc, totalDiscountAmount and
      // totalDiscountPercentage are left exactly as stored. On enquiries
      // totalDiscountAmount is the discount off MRP (e.g. 14788.98), not
      // scheme + distributor discount, so it must not be recomputed here.
      return {
        ...plain,
        taxableAmt: taxableAmount,
        totalCGST: cgst,
        totalSGST: sgst,
        totalIGST: igst,
        netAmt: netAmount,
      };
    });

    // --------------------------------------------------------
    // ROUND TOTALS
    // --------------------------------------------------------
    totalGrossAmount = round2(totalGrossAmount);
    totalSchemeDiscount = round2(totalSchemeDiscount);
    totalDistributorDiscount = round2(totalDistributorDiscount);
    totalTaxableAmount = round2(totalTaxableAmount);
    totalItemCGST = round2(totalItemCGST);
    totalItemSGST = round2(totalItemSGST);
    totalItemIGST = round2(totalItemIGST);

    // --------------------------------------------------------
    // CHARGES (+ 18% GST on each)
    // --------------------------------------------------------
    const freightCharges = round2(enquiry.freightCharges);
    const deliveryCharges = round2(enquiry.deliveryCharges);
    const handlingCharges = round2(enquiry.handlingCharges);

    const CHARGE_GST_RATE = 18;

    const totalChargesGST = round2(
      round2((freightCharges * CHARGE_GST_RATE) / 100) +
        round2((deliveryCharges * CHARGE_GST_RATE) / 100) +
        round2((handlingCharges * CHARGE_GST_RATE) / 100),
    );

    // interstate (IGST) if the lines carry IGST, else CGST + SGST
    const isIgstOrder = totalItemIGST > 0 || num(enquiry.igst) > 0;

    const chargeCGST = isIgstOrder ? 0 : round2(totalChargesGST / 2);
    const chargeSGST = isIgstOrder ? 0 : round2(totalChargesGST / 2);
    const chargeIGST = isIgstOrder ? totalChargesGST : 0;

    // --------------------------------------------------------
    // FINAL HEADER VALUES
    // --------------------------------------------------------
    const finalTaxableAmount = round2(
      totalTaxableAmount + freightCharges + deliveryCharges + handlingCharges,
    );

    const finalCGST = round2(totalItemCGST + chargeCGST);
    const finalSGST = round2(totalItemSGST + chargeSGST);
    const finalIGST = round2(totalItemIGST + chargeIGST);

    const invoiceAmount = round2(
      finalTaxableAmount + finalCGST + finalSGST + finalIGST,
    );

    const cashDiscount = round2(enquiry.cashDiscount);

    // Enquiries store netAmount rounded to a whole rupee, and roundOffAmount
    // holds that same rounded payable (e.g. invoice 36451.67 -> 36452).
    const finalNetAmount = Math.round(invoiceAmount - cashDiscount);
    const roundOffAmount = finalNetAmount;

    const totalLines = calculatedLineItems.filter(
      (item) => num(item.oderQty) > 0 || num(item.netAmt) > 0,
    ).length;

    // --------------------------------------------------------
    // CHECK HEADER VALUES
    // --------------------------------------------------------
    const headerFields = [
      { field: "totalLines", stored: enquiry.totalLines, calculated: totalLines },
      { field: "grossAmount", stored: enquiry.grossAmount, calculated: totalGrossAmount },
      { field: "schemeDiscount", stored: enquiry.schemeDiscount, calculated: totalSchemeDiscount },
      { field: "distributorDiscount", stored: enquiry.distributorDiscount, calculated: totalDistributorDiscount },
      { field: "taxableAmount", stored: enquiry.taxableAmount, calculated: finalTaxableAmount },
      { field: "cgst", stored: enquiry.cgst, calculated: finalCGST },
      { field: "sgst", stored: enquiry.sgst, calculated: finalSGST },
      { field: "igst", stored: enquiry.igst, calculated: finalIGST },
      { field: "invoiceAmount", stored: enquiry.invoiceAmount, calculated: invoiceAmount },
      { field: "roundOffAmount", stored: enquiry.roundOffAmount, calculated: roundOffAmount },
      { field: "netAmount", stored: enquiry.netAmount, calculated: finalNetAmount },
    ];

    headerFields.forEach(({ field, stored, calculated }) => {
      if (isDifferent(stored, calculated)) {
        hasMismatch = true;
        mismatches.push({
          type: "header",
          field,
          stored: round2(stored),
          calculated,
          difference: round2(num(stored) - calculated),
        });
      }
    });

    // --------------------------------------------------------
    // EVERYTHING CORRECT -> DO NOT TOUCH THE DATABASE
    // --------------------------------------------------------
    if (!hasMismatch) {
    

      return res.status(200).json({
        success: true,
        corrected: false,
        isMismatch: false,
        message: "Order enquiry calculation is already correct",
        data: {
          enquiryId: enquiry._id,
          enquiryNo: enquiry.enquiryNo,
          totalLines,
          netAmount: finalNetAmount,
        },
      });
    }

    enquiry.lineItems = calculatedLineItems;
    enquiry.totalLines = totalLines;
    enquiry.grossAmount = totalGrossAmount;
    enquiry.schemeDiscount = totalSchemeDiscount;
    enquiry.distributorDiscount = totalDistributorDiscount;
    enquiry.taxableAmount = finalTaxableAmount;
    enquiry.cgst = finalCGST;
    enquiry.sgst = finalSGST;
    enquiry.igst = finalIGST;
    enquiry.invoiceAmount = invoiceAmount;
    enquiry.roundOffAmount = roundOffAmount;
    enquiry.netAmount = finalNetAmount;

    await enquiry.save();

  

    return res.status(200).json({
      success: true,
      corrected: true,
      isMismatch: true,
      message: "Order enquiry calculation mismatch found and corrected",
      data: {
        enquiryId: enquiry._id,
        enquiryNo: enquiry.enquiryNo,
        totalLines,
        grossAmount: totalGrossAmount,
        taxableAmount: finalTaxableAmount,
        cgst: finalCGST,
        sgst: finalSGST,
        igst: finalIGST,
        invoiceAmount,
        roundOffAmount,
        cashDiscount,
        netAmount: finalNetAmount,
        mismatchCount: mismatches.length,
        mismatches,
      },
    });
  } catch (error) {
    

    return res.status(500).json({
      success: false,
      message: "Failed to recalculate order enquiry",
      error: error.message,
    });
  }
};