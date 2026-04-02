const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const salesHistoryByRetailer = asyncHandler(async (req, res) => {
  const { retailerId, distributorId } = req.body;

  if (!retailerId || !distributorId) {
    return res.status(400).json({
      status: 400,
      message: "retailerId and distributorId are required",
    });
  }

  const transactions = await DistributorTransaction.find({
    retailerId,
    distributorId,
    transactionType: "debit",
    transactionFor: "SALES",
    status: "Success",
  })
    .sort({ createdAt: 1 })
    .populate("distributorId", "name dbCode")
    .populate("billId", "billNo");

  const grouped = {};

  for (const tx of transactions) {
    const distributorIdStr = tx.distributorId._id.toString();

    if (!grouped[distributorIdStr]) {
      grouped[distributorIdStr] = {
        distributor: {
          _id: distributorIdStr,
          name: tx.distributorId.name,
          code: tx.distributorId.code,
        },
        totalPoints: 0,
        transactions: [],
      };
    }

    grouped[distributorIdStr].totalPoints += tx.point || 0;
    grouped[distributorIdStr].transactions.push(tx);
  }

  const data = Object.values(grouped);

  return res.status(200).json({
    status: 200,
    message: "Sales history fetched successfully",
    data,
  });
});

module.exports = salesHistoryByRetailer;