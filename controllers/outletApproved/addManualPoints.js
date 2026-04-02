const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { retailerOutletTransactionCode } = require("../../utils/codeGenerator");

const addManualPoints = asyncHandler(async (req, res) => {
  try {
    const { outletId } = req.params;
    const { points, reason, transactionType, transactionFor } = req.body;

    console.log(outletId);

    if (!outletId) {
      res.status(400);
      throw new Error("outlet Id is required");
    }
    if (!points || typeof points !== "number") {
      res.status(400);
      throw new Error("valid ppint value is required");
    }
    if (points <= 0) {
      res.status(400);
      throw new Error("Points must be greater then 0");
    }
    const outlet = await OutletApproved.findById(outletId);

    if (!outlet) {
      res.status(400);
      throw new Error("Outlet not found");
    }

    // ✅ CHECK: If transactionFor is "Opening Points", block if already added
    if (transactionFor === "Opening Points") {
      if (outlet.isFirstOpeningPoint === true) {
        res.status(400);
        throw new Error("Opening balance already added for this retailer");
      }
    }

    const previousBalance = outlet.currentPointBalance || 0;
    const isDebit = transactionType === "debit";

    // Check sufficient balance for debit
    if (isDebit && previousBalance < points) {
      res.status(400);
      throw new Error("Insufficient balance");
    }

    const newBalance = isDebit
      ? previousBalance - points
      : previousBalance + points;
    outlet.currentPointBalance = newBalance;

    // ✅ Set isFirstOpeningPoint flag ONLY for Opening Points
    if (transactionFor === "Opening Points") {
      outlet.isFirstOpeningPoint = true;
    }

    await outlet.save();

    //creating a new transaction
    await RetailerOutletTransaction.create({
      retailerId: outlet._id,
      transactionId: await retailerOutletTransactionCode("RTO"),
      transactionType: transactionType || "credit",
      transactionFor: transactionFor || "Manual Point",
      point: points,
      balance: newBalance,
      distributorId: outlet.distributorId || null,
      status: "Success",
      remark:
        reason || (isDebit ? "Manual points deducted" : "Manual points added"),
    });
    // update outletApproved isFirstOpeningPoint to true

    // outlet.isFirstOpeningPoint = true;
    // await outlet.save();

    return res.status(200).json({
      status: 200,
      message: isDebit
        ? "Points deducted successfully"
        : "Points added successfully",
      data: {
        outletId: outlet._id,
        outletCode: outlet.outletCode,
        outletName: outlet.outletName,
        previousBalance,
        points: points,
        operation: isDebit ? "deducted" : "added",
        newBalance,
        transactionFor: transactionFor || "Manual Point",
        reason:
          reason ||
          (isDebit ? "Manual points deducted" : "Manual points added"),
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "failed to add points");
  }
});

module.exports = { addManualPoints };
