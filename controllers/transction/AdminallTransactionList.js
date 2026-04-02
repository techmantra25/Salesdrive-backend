const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model");
const mongoose = require("mongoose");
const moment = require("moment-timezone");

const allTransactionList = asyncHandler(async (req, res) => {
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
    } = req.query;

    const { distributorId, invoiceId } = req.body;

    // Validate distributorId
    if (!distributorId || !mongoose.Types.ObjectId.isValid(distributorId)) {
      res.status(400);
      throw new Error("Valid distributor ID is required in request body");
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build the match stage for filtering
    const matchStage = {
      distributorId: new mongoose.Types.ObjectId(distributorId),
    };

    if (req.query.invoiceId) {
      matchStage.invoiceId = req.query.invoiceId;
    }

    // Filter by invoiceId from body if provided
    if (invoiceId) {
      matchStage.invoiceId = new mongoose.Types.ObjectId(invoiceId);
    }

    // Accept timezone from client or default to Asia/Kolkata
    const USER_TZ = req.query.timezone || "Asia/Kolkata";

    if (fromDate || toDate) {
      matchStage.createdAt = {};

      console.log("Date filter - raw fromDate/toDate:", {
        fromDate,
        toDate,
        timezone: USER_TZ,
      });

      if (fromDate) {
        const start = moment
          .tz(fromDate, "YYYY-MM-DD", USER_TZ)
          .startOf("day")
          .utc()
          .toDate();

        matchStage.createdAt.$gte = start;
        console.log("Date filter - computed startUtc:", start.toISOString());
      }

      if (toDate) {
        const end = moment
          .tz(toDate, "YYYY-MM-DD", USER_TZ)
          .add(1, "day")
          .startOf("day")
          .utc()
          .toDate();

        matchStage.createdAt.$lt = end;
        console.log("Date filter - computed endUtc:", end.toISOString());
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

    // Enhanced search logic: If searchTerm is provided, check if it matches product codes
    if (searchTerm) {
      // First, find products that match the search term
      const matchingProducts = await Product.find({
        $or: [
          { product_code: { $regex: searchTerm, $options: "i" } },
          { name: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      const productIds = matchingProducts.map((p) => p._id);

      // Build search condition for transactions
      matchStage.$or = [
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];

      // If we found matching products, add them to the search
      if (productIds.length > 0) {
        matchStage.$or.push({ productId: { $in: productIds } });
      }
    }

    // Fetch filtered transactions with population of related fields
    const transactionData = await Transaction.find(matchStage)
      .populate({
        path: "productId",
        select: "",
        model: "Product",
      })
      .populate({
        path: "invItemId",
        model: "Inventory",
      })
      .populate({
        path: "distributorId",
        select: "",
        model: "Distributor",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    // Total filtered count
    const totalFilteredCount = await Transaction.countDocuments(matchStage);

    // Total items count (without any filtering)
    const totalItemsCount = await Transaction.countDocuments({
      distributorId: new mongoose.Types.ObjectId(distributorId),
    });

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

module.exports = { allTransactionList };
