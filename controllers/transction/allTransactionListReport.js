const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");
const mongoose = require("mongoose");

const allTransactionListReport = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      searchTerm,
      type,
      stockType,
      toDate,
      fromDate,
      transactionFor,
      distributorId,
      distributorIds,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const matchStage = {};

    if (distributorId) {
      matchStage.distributorId = new mongoose.Types.ObjectId(distributorId);
    }

    if (distributorIds) {
      matchStage.distributorId = {
        $in: distributorIds
          .split(",")
          .map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    // Date filtering
    if (fromDate || toDate) {
      matchStage.createdAt = {};
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

    // Filter by transaction type if provided
    if (type) {
      matchStage.type = type;
    }

    // stock type
    if (stockType) {
      matchStage.stockType = stockType;
    }

    // Filter by transaction for if provided
    if (transactionFor) {
      matchStage.transactionType = transactionFor;
    }

    // Filter by searchTerm if provided (assuming searchTerm refers to transactionId)
    if (searchTerm) {
      // Case-insensitive search for transactionId
      matchStage.transactionId = { $regex: searchTerm, $options: "i" };
    }

    // Fetch filtered transactions with population of related fields
    const transactionData = await Transaction.find(matchStage)
      .populate({
        path: "productId",
        select: "",
        model: "Product", // Assuming your product model is named Product
      })
      .populate({
        path: "invItemId",
        model: "", // Assuming your inventory model is named Inventory
      })
      .populate({
        path: "distributorId",
        select: "",
        model: "Distributor", // Assuming your distributor model is named Distributor
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    // Total filtered count
    const totalFilteredCount = await Transaction.countDocuments(matchStage);

    // Total items count (without any filtering)
    const totalMatchStage = {};
    if (distributorId) {
      totalMatchStage.distributorId = new mongoose.Types.ObjectId(
        distributorId
      );
    }

    if (distributorIds) {
      totalMatchStage.distributorId = {
        $in: distributorIds
          .split(",")
          .map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const totalItemsCount = await Transaction.countDocuments(totalMatchStage);

    // Pagination calculation
    const totalPages = Math.ceil(totalFilteredCount / limitNum);

    return res.status(200).json({
      status: 200,
      message: "Transaction list retrieved successfully",
      data: transactionData,
      pagination: {
        currentPage: pageNum,
        limit: limitNum,
        totalPages,
        totalCount: totalItemsCount,
        filteredCount: totalFilteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { allTransactionListReport };
