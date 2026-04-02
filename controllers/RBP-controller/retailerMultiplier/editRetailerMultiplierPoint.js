const asyncHandler = require("express-async-handler");

const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");

const editRetailerMultiplierPoint = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { point, monthTotalPoints } = req.body;

  //  Validate ID
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    res.status(400);
    throw new Error("Invalid multiplier transaction id");
  }

  // Validate input
  if (point === undefined && monthTotalPoints === undefined) {
    res.status(400);
    throw new Error(
      "At least one field (point or monthTotalPoints) is required",
    );
  }

  if (
    (point !== undefined && isNaN(point)) ||
    (monthTotalPoints !== undefined && isNaN(monthTotalPoints))
  ) {
    res.status(400);
    throw new Error("Point values must be numeric");
  }

  // 🔍 Fetch transaction
  const txn = await RetailerMultiplierTransaction.findById(id);

  if (!txn) {
    res.status(404);
    throw new Error("Multiplier transaction not found");
  }

  const updates = {};
  const meta = {};

  /**
   *  Update POINT
   */
  if (point !== undefined) {
    const newPoint = Number(point);

    updates.point = newPoint;

    meta.oldPoint = txn.point;
    meta.newPoint = newPoint;

    if (!txn.retailerOutletTransactionId) {
      res.status(400);
      throw new Error("Linked outlet transaction missing");
    }

    // Sync outlet transaction
    const outletUpdateResult = await RetailerOutletTransaction.updateOne(
      { _id: txn.retailerOutletTransactionId },
      { $set: { point: newPoint } },
      { timestamps: false },
    );

    if (outletUpdateResult.matchedCount === 0) {
      res.status(404);
      throw new Error("Linked outlet transaction not found");
    }
  }

  /**
   * 2️ Update MONTH TOTAL POINTS
   */
  if (monthTotalPoints !== undefined) {
    const newMonthTotalPoints = Number(monthTotalPoints);

    updates.monthTotalPoints = newMonthTotalPoints;

    meta.oldMonthTotalPoints = txn.monthTotalPoints;
    meta.newMonthTotalPoints = newMonthTotalPoints;
  }

  /**
   *  Mark as edited if ANY editable field was sent
   */
  if (point !== undefined || monthTotalPoints !== undefined) {
    updates.isEdited = true;
  }

  /**
   *  Apply updates
   */
  await RetailerMultiplierTransaction.updateOne(
    { _id: id },
    { $set: updates },
    { timestamps: false },
  );

  res.status(200).json({
    success: true,
    message: "Multiplier transaction updated successfully",
    meta,
  });
});

module.exports = { editRetailerMultiplierPoint };
