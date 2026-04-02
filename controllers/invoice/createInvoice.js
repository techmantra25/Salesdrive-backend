const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Distributor = require("../../models/distributor.model");

// Create Invoice
const createInvoice = asyncHandler(async (req, res) => {
  try {
    const {
      distributorId,
      invoiceNo,
      date,
      status,
      grnDate,
      shipping,
      lineItems,
      grossAmount,
      tradeDiscount,
      itemDiscount,
      cashDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      tcsAmount,
      roundOff,
      totalInvoiceAmount,
    } = req.body;

    // Validate distributor
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    // Validate lineItems
    const validatedLineItems = await Promise.all(
      lineItems.map(async (item) => {
        const product = await Product.findById(item.product);
        const price = await Price.findById(item.price);

        if (!product) {
          throw new Error(`Product with id ${item.product} not found`);
        }

        if (!price) {
          throw new Error(`Price with id ${item.price} not found`);
        }

        return {
          product: product._id,
          price: price._id,
          goodsType: item.goodsType,
          mrp: item.mrp,
          qty: item.qty,
          receivedQty: item.receivedQty,
          grossAmount: item.grossAmount,
          discountAmount: item.discountAmount || 0,
          gstAmount: item.gstAmount,
          netAmount: item.netAmount,
          shortageQty: item.shortageQty || 0,
          shortageUom: item.shortageUom || null,
          damageQty: item.damageQty || 0,
          damageUom: item.damageUom || null,
          taxableAmount: item.taxableAmount,
        };
      })
    );

    // Create and save the invoice
    const newInvoice = new Invoice({
      distributorId,
      invoiceNo,
      date,
      status,
      grnDate,
      shipping,
      lineItems: validatedLineItems,
      totalLines: validatedLineItems.length,
      grossAmount,
      tradeDiscount,
      itemDiscount,
      cashDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      tcsAmount,
      roundOff,
      totalInvoiceAmount,
    });

    const savedInvoice = await newInvoice.save();

    res.status(200).json({
      status: 200,
      message: "Invoice created successfully",
      data: savedInvoice,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message || "Something went wrong");
  }
});

module.exports = { createInvoice };
