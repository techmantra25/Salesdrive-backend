const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");

const printMissingRetailerMultiplierTxnCount = asyncHandler(async (req, res) => {

  const volumeMultiplierMissing = await RetailerMultiplierTransaction.countDocuments({
    transactionFor: "Volume Multiplier",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  const consistencyMultiplierMissing = await RetailerMultiplierTransaction.countDocuments({
    transactionFor: "Consistency Multiplier",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  const billVolumeMultiplierMissing = await RetailerMultiplierTransaction.countDocuments({
    transactionFor: "Bill Volume Multiplier",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  const salesReturnMissing = await RetailerMultiplierTransaction.countDocuments({
    transactionFor: "Sales Return",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  const otherMissing = await RetailerMultiplierTransaction.countDocuments({
    transactionFor: "Other",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  res.json({
    success: true,
    data: {
      volumeMultiplierMissing,
      consistencyMultiplierMissing,
      billVolumeMultiplierMissing,
      salesReturnMissing,
      otherMissing,
    },
  });
});

module.exports = { printMissingRetailerMultiplierTxnCount };