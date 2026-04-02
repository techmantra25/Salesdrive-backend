const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");

const printMissingOutletTxnCount = asyncHandler(async (req, res) => {


  const salesMissing = await DistributorTransaction.countDocuments({
  
    transactionFor: "SALES",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  const salesReturnMissing = await DistributorTransaction.countDocuments({

    transactionFor: "Sales Return",
    status: "Success",
    retailerOutletTransactionId: { $exists: false },
  });

  res.json({
    success: true,
    data: {
      salesMissing,
      salesReturnMissing,
    },
  });
});

module.exports = { printMissingOutletTxnCount };
