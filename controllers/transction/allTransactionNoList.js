const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");
const mongoose = require("mongoose");

const transactionlist = asyncHandler(async (req, res) => {
  try {
    const { type, toDate, fromDate, stockType, transactionFor } = req.query;

    // Create a match stage for filtering
    let matchStage = {
      distributorId: new mongoose.Types.ObjectId(req.user?._id),
    };

    // Filter by transaction type if provided
    if (type) {
      matchStage.type = type;
    }

    if (stockType) {
      matchStage.stockType = stockType;
    }

    // Filter by transaction for if provided
    if (transactionFor) {
      matchStage.transactionType = transactionFor;
    }

    // Filter by date range if fromDate or toDate is provided
    if (fromDate || toDate) {
      matchStage.createdAt = {}; // Initialize createdAt field

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = endOfDay;
      }
    }

    // Find transactions with filters applied
    const transactionData = await Transaction.find(matchStage)
      .select("transactionId")
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Transaction list retrieved successfully",
      data: transactionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { transactionlist };
