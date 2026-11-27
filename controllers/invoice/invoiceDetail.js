const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");

// L1 Basic %: use the saved value, else derive it from MRP and gross/qty
const resolveL1Basic = (li) => {
  const saved = Number(li?.l1Basic || 0);
  if (saved > 0) return saved;

  const mrp = Number(li?.mrp || 0);
  const qty = Number(li?.qty || 0);
  const gross = Number(li?.grossAmount || 0);
  if (mrp <= 0 || qty <= 0) return 0;

  const basicRate = gross / qty;
  const pct = ((mrp - basicRate) / mrp) * 100;
  return Math.max(0, Number(pct.toFixed(2)));
};

// PO L1 %: use the saved value, else take it from the matching PO line
const resolvePoL1 = (li, poLines) => {
  const saved = Number(li?.poL1 || 0);
  if (saved > 0) return saved;

  const productId = String(li?.product?._id ?? li?.product ?? "");

  const sameProduct = poLines.filter(
    (p) => String(p?.product?._id ?? p?.product ?? "") === productId
  );

  // prefer the line with the same SO number, else the first line of that product
  const poLine =
    sameProduct.find(
      (p) => li?.soNumber && String(p?.soNumber || "") === String(li.soNumber)
    ) || sameProduct[0];

  return Number(poLine?.l1Basic || 0);
};

const invoiceDetail = asyncHandler(async (req, res) => {
  try {
    const { inId } = req.params;

    const invoice = await Invoice.findById(inId)
      .populate({
        path: "distributorId",
        select: "",
      })
      .populate({
        path: "purchaseOrderId",
        select: "",
        populate: {
          path: "supplierId",
          select: "supplierName supplierCode coCode supplierType",
        },
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

    // plain object so we can set values without touching the database
    const data = invoice.toObject();
    const poLines = data?.purchaseOrderId?.lineItems || [];

    data.lineItems = (data.lineItems || []).map((li) => ({
      ...li,
      l1Basic: resolveL1Basic(li),
      poL1: resolvePoL1(li, poLines),
    }));

    return res.status(200).json({
      status: 200,
      message: "Invoice detail",
      data,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { invoiceDetail };