const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");

const invoiceDetail = asyncHandler(async (req, res) => {
  try {
    const { inId } = req.params;

    const invoice = await Invoice.findById(inId)
      .populate({
        path: "distributorId",
        select: "",
      })
      .populate({
        path: "lineItems.product",
        select: "",
        populate: {
          path: "brand",
          select: "",
        },
      })
      .populate({
        path: "purchaseReturnIds",
        select: "",
        populate: [
          {
            path: "invoiceId",
            select: "",
          },
          {
            path: "distributorId",
            select: "",
          },
          {
            path: "lineItems.product",
            select: "",
            populate: {
              path: "brand",
              select: "",
            },
          },
        ],
      })
      .populate({
        path: "lineItems.plant",
        select: "",
      });

    if (!invoice) {
      res.status(404);
      throw new Error("Invoice not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Invoice detail",
      data: invoice,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { invoiceDetail };
