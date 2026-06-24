const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const OrderEntry = require("../../models/orderEntry.model");
const { orderNumberGenerator } = require("../../utils/codeGenerator");

const convertOrderEnquiryToOrderEntry = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const orderEnquiry = await OrderEnquiry.findById(id);
    if (!orderEnquiry) {
      return res.status(404).json({
        status: 404,
        message: "Order Enquiry not found",
      });
    }

    if (String(orderEnquiry.distributorId) !== String(req.user.id)) {
      return res.status(403).json({
        status: 403,
        message: "You are not allowed to convert this Order Enquiry",
      });
    }

    if (orderEnquiry.status === "Converted" || orderEnquiry.convertedOrderEntryId) {
      return res.status(400).json({
        status: 400,
        message: "Order Enquiry is already converted",
        data: {
          convertedOrderEntryId: orderEnquiry.convertedOrderEntryId,
        },
      });
    }

    if (orderEnquiry.status === "Cancelled") {
      return res.status(400).json({
        status: 400,
        message: "Cancelled Order Enquiry cannot be converted",
      });
    }

    const orderNumber = await orderNumberGenerator("DBO");
    const source = orderEnquiry.toObject();

    const newOrderEntry = await OrderEntry.create({
      distributorId: source.distributorId,
      orderNo: orderNumber,
      salesmanName: source.salesmanName,
      routeId: source.routeId,
      retailerId: source.retailerId,
      orderType: source.orderType,
      orderSource: source.orderSource,
      paymentMode: source.paymentMode,
      lineItems: source.lineItems,
      totalLines: source.totalLines,
      totalBasePoints: source.totalBasePoints,
      grossAmount: source.grossAmount,
      schemeDiscount: source.schemeDiscount,
      distributorDiscount: source.distributorDiscount,
      taxableAmount: source.taxableAmount,
      cgst: source.cgst,
      sgst: source.sgst,
      igst: source.igst,
      invoiceAmount: source.invoiceAmount,
      roundOffAmount: source.roundOffAmount,
      freightCharges: source.freightCharges || 0,
      handlingCharges: source.handlingCharges || 0,
      cashDiscount: source.cashDiscount,
      cashDiscountApplied: source.cashDiscountApplied,
      cashDiscountType: source.cashDiscountType,
      cashDiscountValue: source.cashDiscountValue,
      creditAmount: source.creditAmount,
      netAmount: source.netAmount,
      adjustedCreditNoteIds: source.adjustedCreditNoteIds,
      remark: source.remark,
      orderEnquiryId: source._id,
    });

    orderEnquiry.status = "Converted";
    orderEnquiry.convertedOrderEntryId = newOrderEntry._id;
    orderEnquiry.convertedAt = new Date();
    await orderEnquiry.save();

    return res.status(200).json({
      status: 200,
      message: "Order Enquiry converted to Order Entry successfully",
      data: {
        orderEnquiry,
        orderEntry: newOrderEntry,
      },
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { convertOrderEnquiryToOrderEntry };
