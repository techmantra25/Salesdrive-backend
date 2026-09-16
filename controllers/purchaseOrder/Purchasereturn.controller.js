
const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const PurchaseReturnNew = require("../../models/PurchasereturnNew.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Transaction = require("../../models/transaction.model");

// Generates a sequential purchase return code per distributor
const generatePurchaseReturnCode = async (distributorId) => {
  const count = await PurchaseReturnNew.countDocuments({ distributorId });
  return `PR-${String(count + 1).padStart(6, "0")}`;
};

// Generates a transaction ID
const generateTransactionId = async () => {
  const count = await Transaction.countDocuments({});
  return `LXSTA-${count + 1}`;
};

// Round to 2 decimals
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;


// =====================================================
// CREATE PURCHASE RETURN
// =====================================================
const createPurchaseReturnNew = asyncHandler(async (req, res) => {
  const distributorId = req?.user?._id;

  const {
    godownId,
    returnDate,
    lineItems,
    status,
    returnRemark,
    isIGST,
  } = req.body;

  // Basic validation
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
  const finalStatus = allowedStatuses.includes(status)
    ? status
    : "Draft";

  // Validate line items
  const invalidItem = lineItems.find(
    (item) =>
      !item?.productId ||
      !item?.returnQty ||
      Number(item.returnQty) <= 0
  );

  if (invalidItem) {
    res.status(400);
    throw new Error(
      "Each line item requires a valid productId and a returnQty greater than 0"
    );
  }

  // Recalculate line item amounts
  const normalizedLineItems = lineItems.map((item) => {
    const returnQty = Number(item.returnQty);
    const mrp = Number(item.mrp) || 0;
    const l1BasicPercent = Number(item.l1BasicPercent) || 0;

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

    const gstPercent = isIGST
      ? igstPercent
      : cgstPercent + sgstPercent;

    const gstAmount = round2(
      (taxableAmount * gstPercent) / 100
    );

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

  // Calculate header totals
  const rawTotals = normalizedLineItems.reduce(
    (acc, item) => {
      acc.totalQty += item.returnQty;
      acc.totalTaxableAmount += item.taxableAmount;
      acc.totalGstAmount += item.gstAmount;
      acc.totalAmount += item.netAmount;

      return acc;
    },
    {
      totalQty: 0,
      totalTaxableAmount: 0,
      totalGstAmount: 0,
      totalAmount: 0,
    }
  );

  const totals = {
    totalQty: rawTotals.totalQty,
    totalTaxableAmount: round2(rawTotals.totalTaxableAmount),
    totalGstAmount: round2(rawTotals.totalGstAmount),
    totalAmount: round2(rawTotals.totalAmount),
  };

  try {
    // If returned immediately, validate and deduct stock
    if (finalStatus === "Returned") {
      const productIds = normalizedLineItems.map(
        (item) => item.productId
      );

      const inventoryDocs = await Inventory.find({
        productId: { $in: productIds },
        godownId,
        distributorId,
      });

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
            .select("product_code name");

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
          `Insufficient stock in the selected godown for: ${
            insufficientItems
              .map(
                (i) =>
                  `${i.product_code} (available: ${i.availableQty}, requested: ${i.requestedReturnQty})`
              )
              .join(", ")
          }`
        );
      }

      const returnDateValue = returnDate
        ? new Date(returnDate)
        : new Date();

      // Deduct stock and create transactions
      for (const item of normalizedLineItems) {
        const updated = await Inventory.findOneAndUpdate(
          {
            productId: item.productId,
            godownId,
            distributorId,
            availableQty: { $gte: item.returnQty },
          },
          {
            $inc: {
              availableQty: -item.returnQty,
              totalQty: -item.returnQty,
            },
          },
          { new: true }
        );

        if (!updated) {
          res.status(409);

          throw new Error(
            `Stock for product ${item.productId} changed before the return could be saved. Please retry.`
          );
        }

        const transactionId = await generateTransactionId();

        await Transaction.create([
          {
            distributorId,
            productId: item.productId,
            transactionId,
            invItemId: updated._id,
            billId: null,
            qty: item.returnQty,
            date: returnDateValue,
            type: "Out",
            balanceCount: updated.availableQty,
            description: "Purchase return — stock deducted",
            transactionType: "purchasereturn",
            stockType: "salable",
            godownId,
            dates: {
              deliveryDate: null,
              originalDeliveryDate: null,
            },
            enabledBackDate: false,
          },
        ]);
      }
    }

    // Generate purchase return code
    const code = await generatePurchaseReturnCode(distributorId);

    // Create purchase return
    const purchaseReturnDoc = await PurchaseReturnNew.create([
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
    ]);

    return res.status(201).json({
      status: 201,
      message:
        finalStatus === "Returned"
          ? "Purchase return saved and stock updated successfully"
          : "Purchase return saved as draft",
      data: purchaseReturnDoc[0],
    });
  } catch (error) {
    if (!res.statusCode || res.statusCode === 200) {
      res.status(400);
    }

    throw error;
  }
});


// =====================================================
// CONFIRM PURCHASE RETURN
// Draft -> Returned + stock deduction
// =====================================================
const confirmPurchaseReturnNew = asyncHandler(async (req, res) => {
  const distributorId = req?.user?._id;
  const { purchaseReturnId } = req.params;

  // Basic validation
  if (!distributorId) {
    res.status(401);
    throw new Error("Unauthorized");
  }

  if (
    !purchaseReturnId ||
    !mongoose.Types.ObjectId.isValid(purchaseReturnId)
  ) {
    res.status(400);
    throw new Error("Invalid purchase return id");
  }

  try {
    // Find purchase return
    const purchaseReturn = await PurchaseReturnNew.findOne({
      _id: purchaseReturnId,
      distributorId,
    });

    if (!purchaseReturn) {
      res.status(404);
      throw new Error("Purchase return not found");
    }

    if (purchaseReturn.status !== "Draft") {
      res.status(400);

      throw new Error(
        `Purchase return is already "${purchaseReturn.status}" and cannot be confirmed again`
      );
    }

    const lineItems = purchaseReturn.lineItems || [];
    const godownId = purchaseReturn.godownId;

    if (lineItems.length === 0) {
      res.status(400);
      throw new Error("Purchase return has no line items to confirm");
    }

    // Validate stock availability
    const productIds = lineItems.map(
      (item) => item.productId
    );

    const inventoryDocs = await Inventory.find({
      productId: { $in: productIds },
      godownId,
      distributorId,
    });

    const inventoryByProduct = {};

    inventoryDocs.forEach((inv) => {
      inventoryByProduct[inv.productId.toString()] = inv;
    });

    const insufficientItems = [];

    for (const item of lineItems) {
      const inv = inventoryByProduct[item.productId.toString()];
      const availableQty = inv?.availableQty || 0;

      if (!inv || availableQty < item.returnQty) {
        const product = await Product.findById(item.productId)
          .select("product_code name");

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
        `Insufficient stock in the selected godown for: ${
          insufficientItems
            .map(
              (i) =>
                `${i.product_code} (available: ${i.availableQty}, requested: ${i.requestedReturnQty})`
            )
            .join(", ")
        }`
      );
    }

    const returnDateValue = purchaseReturn.returnDate
      ? new Date(purchaseReturn.returnDate)
      : new Date();

    // Deduct stock and create transactions
    for (const item of lineItems) {
      const updated = await Inventory.findOneAndUpdate(
        {
          productId: item.productId,
          godownId,
          distributorId,
          availableQty: { $gte: item.returnQty },
        },
        {
          $inc: {
            availableQty: -item.returnQty,
            totalQty: -item.returnQty,
          },
        },
        { new: true }
      );

      if (!updated) {
        res.status(409);

        throw new Error(
          `Stock for product ${item.productId} changed before the return could be confirmed. Please retry.`
        );
      }

      const transactionId = await generateTransactionId();

      await Transaction.create([
        {
          distributorId,
          productId: item.productId,
          transactionId,
          invItemId: updated._id,
          billId: null,
          qty: item.returnQty,
          date: returnDateValue,
          type: "Out",
          balanceCount: updated.availableQty,
          description: `Purchase return ${purchaseReturn.code} confirmed — stock deducted`,
          transactionType: "purchasereturn",
          stockType: "salable",
          godownId,
          dates: {
            deliveryDate: null,
            originalDeliveryDate: null,
          },
          enabledBackDate: false,
        },
      ]);
    }

    // Update purchase return status
    purchaseReturn.status = "Returned";
    purchaseReturn.createdAt = new Date();

    await purchaseReturn.save();

    return res.status(200).json({
      status: 200,
      message: "Purchase return confirmed and stock updated successfully",
      data: purchaseReturn,
    });
  } catch (error) {
    if (!res.statusCode || res.statusCode === 200) {
      res.status(400);
    }

    throw error;
  }
});

module.exports = {
  createPurchaseReturnNew,
  confirmPurchaseReturnNew,
};