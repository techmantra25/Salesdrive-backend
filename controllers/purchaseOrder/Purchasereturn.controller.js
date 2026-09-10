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

// Round to 2 decimals, safely handling non-numeric input.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const createPurchaseReturnNew = asyncHandler(async (req, res) => {
  const distributorId = req?.user?._id;
  const { godownId, returnDate, lineItems, status, returnRemark, isIGST } =
    req.body;

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

  // ---- Recompute every money field server-side ----
  // We only trust returnQty, mrp, l1BasicPercent, basicRate, and the gst
  // percents coming from the client. taxableAmount / gstAmount / netAmount
  // (and the header-level totals below) are always derived here, mirroring
  // the pattern used in createSingleBill.js — never trust totals from req.body.
  const normalizedLineItems = lineItems.map((item) => {
    const returnQty = Number(item.returnQty);
    const mrp = Number(item.mrp) || 0;
    const l1BasicPercent = Number(item.l1BasicPercent) || 0;

    // basicRate can be sent directly (frontend already computes it the same
    // way), but if it's missing/invalid we fall back to deriving it from
    // mrp + l1BasicPercent so a bad/absent value can't zero out the return.
    let basicRate = Number(item.basicRate);
    if (!Number.isFinite(basicRate) || basicRate < 0) {
      const discount = (mrp * l1BasicPercent) / 100;
      basicRate = Math.max(0, mrp - discount);
    }
    basicRate = round2(basicRate);

    const cgstPercent = Number(item.cgstPercent) || 0;
    const sgstPercent = Number(item.sgstPercent) || 0;
    const igstPercent = Number(item.igstPercent) || 0;

    const taxableAmount = round2(basicRate * returnQty);

    const gstPercent = isIGST ? igstPercent : cgstPercent + sgstPercent;
    const gstAmount = round2((taxableAmount * gstPercent) / 100);
    const netAmount = round2(taxableAmount + gstAmount);

    return {
      productId: item.productId,
      returnQty,
      mrp,
      l1BasicPercent,
      basicRate,
      taxableAmount,
      cgstPercent,
      sgstPercent,
      igstPercent,
      gstAmount,
      netAmount,
    };
  });

  // ---- Header-level totals, summed from the recomputed line items ----
  const rawTotals = normalizedLineItems.reduce(
    (acc, item) => {
      acc.totalQty += item.returnQty;
      acc.totalTaxableAmount += item.taxableAmount;
      acc.totalGstAmount += item.gstAmount;
      acc.totalAmount += item.netAmount;
      return acc;
    },
    { totalQty: 0, totalTaxableAmount: 0, totalGstAmount: 0, totalAmount: 0 }
  );

  const totals = {
    totalQty: rawTotals.totalQty,
    totalTaxableAmount: round2(rawTotals.totalTaxableAmount),
    totalGstAmount: round2(rawTotals.totalGstAmount),
    totalAmount: round2(rawTotals.totalAmount),
  };

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
          isIGST: !!isIGST,
          lineItems: normalizedLineItems,
          totalQty: totals.totalQty,
          totalTaxableAmount: totals.totalTaxableAmount,
          totalGstAmount: totals.totalGstAmount,
          totalAmount: totals.totalAmount,
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