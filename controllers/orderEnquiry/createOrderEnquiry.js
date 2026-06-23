const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { orderNumberGenerator } = require("../../utils/codeGenerator");

const createOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const {
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
      lineItems = [],
      totalLines,
      totalBasePoints,
      freightCharges,
handlingCharges,
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
      adjustedCreditNoteIds,
      creditAmount,
      remark,
    } = req.body;

    const distributorId = req.user.id;

    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

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

      if (Number(item.oderQty) < 0) {
        return res.status(400).json({
          message: `Negative quantity not allowed for product ${item.product}`,
        });
      }
    }

    const enquiryNo = await orderNumberGenerator("OEQ");

    const savedOrderEnquiry = await OrderEnquiry.create({
      distributorId,
      enquiryNo,
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
      lineItems,
      totalLines,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      freightCharges,
handlingCharges,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      adjustedCreditNoteIds,
      creditAmount,
      remark,
      cashDiscountApplied: req.body.cashDiscountApplied || false,
      cashDiscountType: req.body.cashDiscountType || "amount",
      cashDiscountValue: req.body.cashDiscountValue || 0,
    });

    res.status(200).json({
      status: 200,
      message: "Order Enquiry created successfully",
      data: savedOrderEnquiry,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createOrderEnquiry };
