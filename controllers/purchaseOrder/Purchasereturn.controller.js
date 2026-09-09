const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const PurchaseReturnNew = require("../../models/PurchasereturnNew.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");

// Generates a simple sequential code per distributor, e.g. PR-000123
// Adjust prefix/format to match whatever convention the rest of the app uses.
const generatePurchaseReturnCode = async (distributorId, session) => {
  const count = await PurchaseReturnNew.countDocuments({ distributorId }).session(
    session
  );
  const nextNumber = count + 1;
  return `PR-${String(nextNumber).padStart(6, "0")}`;
};

const createPurchaseReturnNew = asyncHandler(async (req, res) => {
  const distributorId = req?.user?._id;
  const { godownId, returnDate, lineItems, status, returnRemark } = req.body;

  // ---- Basic validation ----
  if (!distributorId) {
    res.status(401);
    throw new Error("Unauthorized");
  }

  if (!godownId) {
    res.status(400);
    throw new Error("godownId is required");
  }

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    res.status(400);
    throw new Error("At least one product is required");
  }

  const allowedStatuses = ["Draft", "Returned"];
  const finalStatus = allowedStatuses.includes(status) ? status : "Draft";

  // Validate each line item shape
  const invalidItem = lineItems.find(
    (item) => !item?.productId || !item?.returnQty || Number(item.returnQty) <= 0
  );
  if (invalidItem) {
    res.status(400);
    throw new Error(
      "Each line item requires a valid productId and a returnQty greater than 0"
    );
  }

  const normalizedLineItems = lineItems.map((item) => ({
    productId: item.productId,
    returnQty: Number(item.returnQty),
  }));

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // ---- If status is "Returned", validate stock availability BEFORE
    // touching anything, so we never partially deduct. ----
    if (finalStatus === "Returned") {
      const productIds = normalizedLineItems.map((item) => item.productId);

      const inventoryDocs = await Inventory.find({
        productId: { $in: productIds },
        godownId: godownId,
        distributorId: distributorId,
      }).session(session);

      const inventoryByProduct = {};
      inventoryDocs.forEach((inv) => {
        inventoryByProduct[inv.productId.toString()] = inv;
      });

      const insufficientItems = [];

      for (const item of normalizedLineItems) {
        const inv = inventoryByProduct[item.productId.toString()];
        const availableQty = inv?.availableQty || 0;

        if (!inv || availableQty < item.returnQty) {
          const product = await Product.findById(item.productId)
            .select("product_code name")
            .session(session);
          insufficientItems.push({
            productId: item.productId,
            product_code: product?.product_code || item.productId,
            name: product?.name || "",
            availableQty,
            requestedReturnQty: item.returnQty,
          });
        }
      }

      if (insufficientItems.length > 0) {
        res.status(400);
        throw new Error(
          `Insufficient stock in the selected godown for: ${insufficientItems
            .map(
              (i) =>
                `${i.product_code} (available: ${i.availableQty}, requested: ${i.requestedReturnQty})`
            )
            .join(", ")}`
        );
      }

      // ---- Deduct stock for each product in this godown ----
      for (const item of normalizedLineItems) {
        const updated = await Inventory.findOneAndUpdate(
          {
            productId: item.productId,
            godownId: godownId,
            distributorId: distributorId,
            availableQty: { $gte: item.returnQty }, // guards against race conditions
          },
          {
            $inc: {
              availableQty: -item.returnQty,
              totalQty: -item.returnQty,
            },
          },
          { new: true, session }
        );

        if (!updated) {
          // Someone else modified stock between our check and this update
          res.status(409);
          throw new Error(
            `Stock for product ${item.productId} changed before the return could be saved. Please retry.`
          );
        }
      }
    }

    // ---- Generate code and create the return document ----
    const code = await generatePurchaseReturnCode(distributorId, session);

    const purchaseReturnDoc = await PurchaseReturnNew.create(
      [
        {
          code,
          distributorId,
          godownId,
          returnDate: returnDate || Date.now(),
          lineItems: normalizedLineItems,
          status: finalStatus,
          returnRemark: (returnRemark || "").trim(),
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      status: 201,
      message:
        finalStatus === "Returned"
          ? "Purchase return saved and stock updated successfully"
          : "Purchase return saved as draft",
      data: purchaseReturnDoc[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    // Re-throw with whatever status was already set (asyncHandler needs a
    // status code set before throwing, matching the pattern in this codebase)
    if (!res.statusCode || res.statusCode === 200) {
      res.status(400);
    }
    throw error;
  }
});

module.exports = { createPurchaseReturnNew };