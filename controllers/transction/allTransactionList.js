const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");
const Product = require("../../models/product.model");
const mongoose = require("mongoose");
const Bill = require("../../models/bill.model");
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
      productId,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build the match stage for filtering
    const matchStage = {
      distributorId: new mongoose.Types.ObjectId(req.user?._id),
    };

    if (req.query.invoiceId) {
      matchStage.invoiceId = req.query.invoiceId;
    }

    // Accept timezone from client or default to Asia/Kolkata
    const USER_TZ = req.query.timezone || "Asia/Kolkata";

    if (fromDate || toDate) {
      matchStage.createdAt = {};

      console.log("Date filter - raw fromDate/toDate:", {
        fromDate,
        toDate,
      });

      if (fromDate) {
        // Create start of day in IST (00:00:00 IST = 18:30:00 previous day UTC)
        const [year, month, day] = fromDate.split("-");
        const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        // IST is UTC+5:30, so subtract 5:30 from IST to get UTC
        start.setUTCHours(start.getUTCHours() - 5);
        start.setUTCMinutes(start.getUTCMinutes() - 30);

        matchStage.createdAt.$gte = start;
        console.log("Date filter - computed start:", start.toISOString());
      }

      if (toDate) {
        // Create end of day in IST (23:59:59.999 IST = 18:29:59.999 same day UTC)
        const [year, month, day] = toDate.split("-");
        const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        // IST is UTC+5:30, so subtract 5:30 from IST to get UTC
        end.setUTCHours(end.getUTCHours() - 5);
        end.setUTCMinutes(end.getUTCMinutes() - 30);

        matchStage.createdAt.$lte = end;
        console.log("Date filter - computed end:", end.toISOString());
      }
    }
    // Filter by transaction type
    if (type && type !== "all") {
      matchStage.type = type;
    }

    // stock type filter
    if (stockType && stockType !== "all") {
      matchStage.stockType = stockType;
    }

    // product filter
    if (req.query.productIds) {
      const ids = req.query.productIds
        .split(",")
        .map((id) => new mongoose.Types.ObjectId(id));

      matchStage.productId = { $in: ids };
    }

    // transaction type filter
    if (transactionFor && transactionFor !== "all") {
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

      // adjust path
      const matchingBills = await Bill.find({
        $or: [
          { billNo: { $regex: searchTerm, $options: "i" } },
          { new_billno: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      const productIds = matchingProducts.map((p) => p._id);
      const billIds = matchingBills.map((b) => b._id);

      // Build search condition for transactions
      matchStage.$or = [
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];

      // If we found matching products, add them to the search
      if (productIds.length > 0) {
        matchStage.$or.push({ productId: { $in: productIds } });
      }
      if (billIds.length > 0) {
        matchStage.$or.push({ billId: { $in: billIds } });
        console.log("i was called");
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
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum);

    // Total filtered count
    const totalFilteredCount = await Transaction.countDocuments(matchStage);

    // Total items count (without any filtering)
    const totalItemsCount = await Transaction.countDocuments({
      distributorId: req.user._id,
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
