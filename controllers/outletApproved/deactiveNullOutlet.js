const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// Update status=false where mobile1 is null/empty AND currentPointBalance = 0
const disableOutlets = asyncHandler(async (req, res) => {
  const result = await OutletApproved.updateMany(
    {
      $and: [
        { currentPointBalance: 0 },
        {
          $or: [
            { mobile1: null },
            { mobile1: "" },
            { mobile1: { $exists: false } },
          ],
        },
      ],
    },
    { $set: { status: false } }
  );

  res.status(200).json({
    success: true,
    message: "Outlets updated successfully",
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
});

module.exports = { disableOutlets };
