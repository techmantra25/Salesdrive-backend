const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Inventory = require("../../models/inventory.model");

const invoiceDetailForSaleReturn = asyncHandler(async (req, res) => {
  const { inId } = req.params;

  const invoice = await Invoice.findById(inId)
    .populate("distributorId")
    .populate({
      path: "lineItems.product",
      populate: { path: "brand" },
    })
    .populate({
      path: "purchaseReturnIds",
      populate: [
        { path: "invoiceId" },
        { path: "distributorId" },
        {
          path: "lineItems.product",
          populate: { path: "brand" },
        },
      ],
    })
    .populate("lineItems.plant")
    .lean(); // 🔥 IMPORTANT

  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  /* --------------------------------------------
     1️⃣ Collect productIds from invoice lineItems
  --------------------------------------------- */
  const productIds = invoice.lineItems
    .map((item) => item.product?._id)
    .filter(Boolean);

  /* --------------------------------------------
     2️⃣ Fetch inventory for these products
  --------------------------------------------- */
  const inventories = await Inventory.find({
    productId: { $in: productIds },
    distributorId: invoice.distributorId?._id,
  }).lean();

  /* --------------------------------------------
     3️⃣ Create lookup map: productId -> inventory
  --------------------------------------------- */
  const inventoryMap = {};
  inventories.forEach((inv) => {
    inventoryMap[inv.productId.toString()] = inv;
  });

  /* --------------------------------------------
     4️⃣ Attach inventory to each line item
  --------------------------------------------- */
  invoice.lineItems = invoice.lineItems.map((item) => {
    const productId = item.product?._id?.toString();

    return {
      ...item,
      inventory: inventoryMap[productId] || null,
      inventoryId: inventoryMap[productId]?._id || null,
      invitemId: inventoryMap[productId]?.invitemId || null,
    };
  });

  return res.status(200).json({
    status: 200,
    message: "Invoice detail",
    data: invoice,
  });
});

module.exports = { invoiceDetailForSaleReturn };
