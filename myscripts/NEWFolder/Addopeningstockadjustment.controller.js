const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const Inventory = require("../../models/inventory.model");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model"); // ← added
const { transactionCode } = require("../../utils/codeGenerator");

const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(id);

/**
 * POST /api/v1/db-transaction/add-opening-stock-adjustment
 *
 * Body:
 * {
 *   distributorId: "xxx",
 *   stockType: "salable" | "unsalable"  (default: "salable")
 *   products: [
 *     { productId: "xxx", qty: 10 },
 *     { productId: "yyy", qty: 5 },
 *   ]
 * }
 *
 * Logic:
 * - If an opening stock transaction already exists for that distributor+product
 *   → UPDATE: add qty to existing transaction's qty
 * - Else
 *   → CREATE: new openingstock transaction dated (distributor.createdAt + 1 day)
 */
const addOpeningStockAdjustment = asyncHandler(async (req, res) => {
  const { distributorId, products = [], stockType = "salable" } = req.body;

  /* -- basic validation -------------------------------------------- */
  if (!distributorId) {
    res.status(400);
    throw new Error("distributorId is required");
  }

  if (!isValidObjectId(distributorId)) {
    res.status(400);
    throw new Error("Invalid distributorId");
  }

  if (!Array.isArray(products) || !products.length) {
    res.status(400);
    throw new Error("products array is required and must not be empty");
  }

  if (!["salable", "unsalable"].includes(stockType)) {
    res.status(400);
    throw new Error("stockType must be salable or unsalable");
  }

  for (const p of products) {
    if (!p.productId || !isValidObjectId(p.productId)) {
      res.status(400);
      throw new Error(`Invalid productId: ${p.productId}`);
    }
    if (!p.qty || Number(p.qty) <= 0) {
      res.status(400);
      throw new Error(`qty must be a positive number for productId: ${p.productId}`);
    }
  }

  /* -- fetch distributor ------------------------------------------- */
  const distributor = await Distributor.findById(distributorId)
    .select("createdAt name dbCode")
    .lean();

  if (!distributor) {
    res.status(404);
    throw new Error("Distributor not found");
  }

  // fallback date: day after distributor was created
  const fallbackDate = new Date(distributor.createdAt);
  fallbackDate.setDate(fallbackDate.getDate() + 1);

  /* -- batch fetch product names ----------------------------------- */
  const productIds = products.map((p) => p.productId);
  const productDocs = await Product.find({ _id: { $in: productIds } })
    .select("name")
    .lean();

  const productNameMap = Object.fromEntries(
    productDocs.map((p) => [p._id.toString(), p.name])
  );

  /* -- process each product ---------------------------------------- */
  const updated = [];
  const created = [];
  const skipped = [];
  const errors = [];

  for (const item of products) {
    const qtyToAdd = Number(item.qty);
    const productName = productNameMap[item.productId] || item.productId; // fallback to ID if not found

    try {
      /* -- find inventory record ----------------------------------- */
      const inventoryDoc = await Inventory.findOne({
        distributorId,
        productId: item.productId,
      });

      if (!inventoryDoc) {
        skipped.push({
          productId: item.productId,
          reason: "Inventory record not found for this distributor + product",
        });
        continue;
      }

      /* -- check if opening stock transaction already exists ------- */
      const existingTransaction = await Transaction.findOne({
        distributorId,
        productId: item.productId,
        invItemId: inventoryDoc._id,
        transactionType: "openingstock",
        stockType,
        type: "In",
      });

      if (existingTransaction) {
        /* -- UPDATE: add qty to existing transaction --------------- */
        const oldQty = existingTransaction.qty;
        existingTransaction.qty = oldQty + qtyToAdd;
        await existingTransaction.save();

        updated.push({
          transactionId: existingTransaction.transactionId,
          _id: existingTransaction._id,
          productId: item.productId,
          previousQty: oldQty,
          addedQty: qtyToAdd,
          newQty: existingTransaction.qty,
        });
      } else {
        /* -- CREATE: new opening stock transaction ----------------- */
        const newTransactionId = await transactionCode("LXSTA");

        const balanceCount =
          stockType === "salable"
            ? inventoryDoc.availableQty
            : inventoryDoc.unsalableQty;

        const newTransaction = await Transaction.create({
          distributorId,
          productId: item.productId,
          transactionId: newTransactionId,
          invItemId: inventoryDoc._id,
          qty: qtyToAdd,
          date: fallbackDate,
          type: "In",
          balanceCount,
          description: `Opening stock for ${productName}`, // ← updated
          transactionType: "openingstock",
          stockType,
          createdAt: fallbackDate,
          updatedAt: fallbackDate,
        });

        created.push({
          transactionId: newTransaction.transactionId,
          _id: newTransaction._id,
          productId: item.productId,
          qty: qtyToAdd,
          date: fallbackDate,
        });
      }
    } catch (err) {
      errors.push({
        productId: item.productId,
        reason: err.message,
      });
    }
  }

  return res.status(200).json({
    success: true,
    message: "Opening stock adjustment processed",
    data: {
      distributorId,
      distributorCode: distributor.dbCode || "",
      distributorName: distributor.name || "",
      stockType,
      summary: {
        totalRequested: products.length,
        updated: updated.length,
        created: created.length,
        skipped: skipped.length,
        errors: errors.length,
      },
      updated,
      created,
      skipped,
      errors,
    },
  });
});

module.exports = { addOpeningStockAdjustment };