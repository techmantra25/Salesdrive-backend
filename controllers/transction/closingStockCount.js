const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");

const closingStockCount = asyncHandler(async (req, res) => {
  try {
    // Convert date to JavaScript Date object
    let date = req.query.date;
    let endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    // Fetch transaction data filtered by productId, distributorId, and date filter
    const transactionData = await Transaction.find({
      $and: [
        { productId: req.query.productId },
        { distributorId: req.query.distributorId },
        { createdAt: { $lt: endDate } }, // Filter by date if provided
      ],
    }).sort({ createdAt: -1 }); // Sort by createdAt in descending order

    // Calculate total In and Out quantities
    let totalInQty = 0;
    let totalOutQty = 0;

    transactionData.forEach((transaction) => {
      if (transaction.type === "In") {
        totalInQty += transaction.qty;
      } else if (transaction.type === "Out") {
        totalOutQty += transaction.qty;
      }
    });

    const closingQty = totalInQty - totalOutQty;

    return res.status(200).json({
      status: 200,
      message: "Transaction list and closing stock retrieved successfully",
      data: {
        totalInQty,
        totalOutQty,
        closingQty,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { closingStockCount };
