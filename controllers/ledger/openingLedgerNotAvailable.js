const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Ledger = require("../../models/ledger.model");

const openingLedgerNotAvailable = asyncHandler(async (req, res) => {
  try {
    const { _id: dbId } = req.user;

    const allRetailer = await OutletApproved.find({
      distributorId: dbId,
      status: true,
    });

    const retailerIds = allRetailer.map((retailer) => retailer._id);

    // find the "Opening Balance" ledger for each retailer with this distributorId
    // those who do not have "Opening Balance" ledger will be returned

    const openingBalanceLedgers = await Ledger.find({
      dbId,
      retailerId: { $in: retailerIds },
      transactionFor: "Opening Balance",
    });

    const openingBalanceRetailerIds = openingBalanceLedgers.map(
      (ledger) => ledger.retailerId
    );

    const openingBalanceRetailerIdsSet = new Set(openingBalanceRetailerIds);

    const retailerIdsSet = new Set(retailerIds);

    const notAvailableRetailerIds = [...retailerIdsSet].filter(
      (id) => !openingBalanceRetailerIdsSet.has(id)
    );

    const notAvailableRetailers = await OutletApproved.find({
      _id: { $in: notAvailableRetailerIds },
    });

    res.status(200).json({
      status: 200,
      message: "Opening balance ledger not available for these retailers",
      data: notAvailableRetailers,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { openingLedgerNotAvailable };
