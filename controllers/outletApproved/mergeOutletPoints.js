const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { retailerOutletTransactionCode } = require("../../utils/codeGenerator");

const mergeOutletPoints = asyncHandler(async (req, res) => {
  try {
    const { mobile } = req.params;

    if (!mobile) {
      return res.status(400).json({
        status: 400,
        message: "Mobile number is required",
      });
    }

    // 🔹 Fetch active outlets with NON-ZERO balance
    const outlets = await OutletApproved.find({
      status: true,
      mobile1: mobile,
      currentPointBalance: { $gt: 0 },
    });

    if (outlets.length < 2) {
      return res.status(400).json({
        status: 400,
        message:
          "At least two active outlets with non-zero balance are required for merge",
      });
    }

    // 🔹 Find PRIMARY outlet (MAX balance)
    const primaryOutlet = outlets.reduce((max, o) =>
      o.currentPointBalance > max.currentPointBalance ? o : max,
    );

    const secondaryOutlets = outlets.filter(
      (o) => !o._id.equals(primaryOutlet._id),
    );

    const mergedPoints = secondaryOutlets.reduce(
      (sum, o) => sum + o.currentPointBalance,
      0,
    );

    // 🔐 LOCK PRIMARY OUTLET (atomic)
    const lockedPrimary = await OutletApproved.findOneAndUpdate(
      {
        _id: primaryOutlet._id,
        mergeInProgress: { $ne: true },
      },
      {
        $set: {
          mergeInProgress: true,
          mergedPoints: mergedPoints,
          mergedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!lockedPrimary) {
      return res.status(409).json({
        status: 409,
        message: "Merge already in progress or already completed",
      });
    }

    // 🔹 Deactivate SECONDARY outlets and collect massistRefIds
    const massistRefIdsFromSecondaries = secondaryOutlets.flatMap(
      (o) => o.massistRefIds || [],
    );

    // Create debit transactions for inactive outlets before deactivating them
    for (const outlet of secondaryOutlets) {
      const transactionId = await retailerOutletTransactionCode("RTO");
      await RetailerOutletTransaction.create({
        retailerId: outlet._id,
        transactionId: transactionId,
        transactionType: "debit",
        transactionFor: "Manual Point",
        point: outlet.currentPointBalance,
        balance: 0,
        distributorId: outlet.distributorId || null,
        status: "Success",
        remark: `Deducted ${outlet.currentPointBalance} points from merged outlet(s): ${outlet.outletUID} and credited to active outlet: ${primaryOutlet.outletUID}.`,
      });
    }

    await OutletApproved.updateMany(
      { _id: { $in: secondaryOutlets.map((o) => o._id) } },
      {
        $set: {
          status: false,
          currentPointBalance: 0,  // Update balance to zero when deactivating
          mergedInto: primaryOutlet._id,
        },
      },
    );

    // 🔓 Release lock and merge massistRefIds to primary
    await OutletApproved.updateOne(
      { _id: primaryOutlet._id },
      {
        $unset: { mergeInProgress: "" },
        $addToSet: {
          massistRefIds: { $each: massistRefIdsFromSecondaries },
        },
      },
    );

    console.log(
      "Merged outlets:",
      primaryOutlet._id,
      secondaryOutlets.map((o) => o._id),
    );
    console.log("Merged points:", mergedPoints);

    // 🔹 Add merged points as manual entry to primary outlet
    let newBalance = primaryOutlet.currentPointBalance || 0;

    if (mergedPoints > 0) {
      newBalance = newBalance + mergedPoints;

      // Update primary outlet balance
      await OutletApproved.findByIdAndUpdate(primaryOutlet._id, {
        currentPointBalance: newBalance,
      });

      // Create transaction record
      const deactivatedOutletCodes = secondaryOutlets
        .map((o) => o.outletUID)
        .join(", ");
      const transactionId = await retailerOutletTransactionCode("RTO");
      console.log(transactionId, "transactionId");
      console.log(deactivatedOutletCodes, "deactivatedOutletCodes");
      await RetailerOutletTransaction.create({
        retailerId: primaryOutlet._id,
        transactionId: transactionId,
        transactionType: "credit",
        transactionFor: "Manual Point",
        point: mergedPoints,
        balance: newBalance,
        distributorId: primaryOutlet.distributorId || null,
        status: "Success",
        remark: `Added ${mergedPoints} points from merging outlet(s): ${deactivatedOutletCodes}`,
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Outlet points merged successfully",
      primaryOutletId: primaryOutlet._id,
      primaryOutletCode: primaryOutlet.outletCode,
      mergedPointsSaved: mergedPoints,
      primaryCurrentBalance: newBalance,
      deactivatedOutletCount: secondaryOutlets.length,
    });
  } catch (error) {
    throw new Error(error?.message || "Merge failed");
  }
});

module.exports = { mergeOutletPoints };
