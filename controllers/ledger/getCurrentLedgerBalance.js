const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Ledger = require("../../models/ledger.model");

const getCurrentLedgerBalance = asyncHandler(async (req, res) => {
  const dbId = req.user?._id;
  if (!dbId) {
    res.status(401);
    throw new Error("User not authenticated or user ID missing.");
  }

  const { retailerId } = req.query;

  if (
    !retailerId ||
    !retailerId.trim() ||
    !mongoose.Types.ObjectId.isValid(retailerId)
  ) {
    res.status(400);
    throw new Error("Valid Retailer ID query parameter is required.");
  }

  const filter = {
    dbId: dbId,
    retailerId: retailerId,
  };

  const latestLedgerEntry = await Ledger.findOne(filter)
    .sort({ createdAt: -1 })
    .lean();

  if (!latestLedgerEntry) {
    return res.status(200).json({
      error: false,
      message: "Ledger not found for this retailer. Balance assumed to be 0.",
      data: {
        balance: 0,
      },
    });
  } else {
    const balance = latestLedgerEntry.balance ?? 0;

    return res.status(200).json({
      error: false,
      message: "Latest ledger balance retrieved successfully.",
      data: {
        balance,
      },
    });
  }
});

module.exports = { getCurrentLedgerBalance };
