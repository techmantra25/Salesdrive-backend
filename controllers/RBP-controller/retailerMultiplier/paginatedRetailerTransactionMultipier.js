const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");

const paginatedRetailerTransactionMultipier = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search,
      retailerId,
      transactionType,
      transactionFor,
      status,
      month,
      year,
      fromDate,
      toDate,
    } = req.query;

    // Convert query params to numbers and set default values
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (page < 1 || limit < 1) {
      res.status(400);
      throw new Error("Page and limit should be positive integers");
    }

    const skip = (page - 1) * limit;

    // Build the filter object
    let filter = {};

    // Retailer filter
    if (retailerId) {
      filter.retailerId = retailerId;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      const orConditions = [];

      // _id search (only if valid ObjectId)
      if (/^[a-f\d]{24}$/i.test(search)) {
        orConditions.push({ _id: search });
      }

      // remark search
      orConditions.push({ remark: searchRegex });

      // Only add $or if there are conditions
      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    // Transaction type filter
    if (transactionType) {
      filter.transactionType = transactionType;
    }

    // Transaction for filter
    if (transactionFor) {
      filter.transactionFor = transactionFor;
    }

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Month filter
    if (month) {
      filter.month = parseInt(month, 10);
    }

    // Year filter
    if (year) {
      filter.year = parseInt(year, 10);
    }

    // Date range filter on createdAt field
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }

    // Fetch transactions with pagination and filter
    const transactions = await RetailerMultiplierTransaction.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ updatedAt: -1 })
      .populate({
        path: "retailerId",
        select: "",
      })
      .populate({
        path: "retailerOutletTransactionId",
        select: "transactionId",
      });

    // Total count for all transactions
    const totalCount = await RetailerMultiplierTransaction.countDocuments();

    // Total filtered count based on filters
    const filteredCount = await RetailerMultiplierTransaction.countDocuments(
      filter
    );

    res.status(200).json({
      status: 200,
      message:
        "Paginated retailer multiplier transactions fetched successfully",
      data: transactions,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { paginatedRetailerTransactionMultipier };
