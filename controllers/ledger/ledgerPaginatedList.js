const asyncHandler = require("express-async-handler");
const Ledger = require("../../models/ledger.model"); // Ensure path is correct
const mongoose = require("mongoose");

const ledgerPaginatedList = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const filter = {};

  // --- Required Filters ---
  // Ensure dbId and retailerId are provided and valid
  if (!req.query.dbId || !mongoose.Types.ObjectId.isValid(req.query.dbId)) {
    res.status(400); // Bad Request
    throw new Error("Valid dbId query parameter is required");
  }
  if (
    !req.query.retailerId ||
    !mongoose.Types.ObjectId.isValid(req.query.retailerId)
  ) {
    res.status(400); // Bad Request
    throw new Error("Valid retailerId query parameter is required");
  }
  filter.dbId = req.query.dbId;
  filter.retailerId = req.query.retailerId;

  // --- Optional Filters ---

  // Transaction Type Filter
  if (req.query.transactionType) {
    if (["credit", "debit"].includes(req.query.transactionType)) {
      filter.transactionType = req.query.transactionType;
    } else {
      // Optional: Throw error for invalid type or just ignore
      console.warn("Invalid transactionType query parameter received.");
    }
  }

  // Transaction For Filter
  if (req.query.transactionFor) {
    const validTransactionFor = [
      "Sales",
      "Sales-Credit-Adjustment",
      "Collection",
      "Collection-Discount",
      "Credit Note",
      "Debit Note",
      "Opening Balance",
      "Collection-Credit-Adjustment",
    ];
    if (validTransactionFor.includes(req.query.transactionFor)) {
      filter.transactionFor = req.query.transactionFor;
    } else {
      // Optional: Throw error for invalid type or just ignore
      console.warn("Invalid transactionFor query parameter received.");
    }
  }

  // Date Range Filter
  if (req.query.fromDate || req.query.toDate) {
    filter.createdAt = {};
    if (req.query.fromDate) {
      const fromDate = new Date(req.query.fromDate);
      if (!isNaN(fromDate)) {
        fromDate.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = fromDate;
      }
    }
    if (req.query.toDate) {
      const toDate = new Date(req.query.toDate);
      if (!isNaN(toDate)) {
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }
    // Clean up if dates were invalid or not set properly
    if (Object.keys(filter.createdAt).length === 0) {
      delete filter.createdAt;
    }
  }

  // --- Search Filter ---
  if (req.query.search) {
    const searchQuery = req.query.search.trim();
    // Apply search to transactionId using case-insensitive regex
    filter.transactionId = { $regex: searchQuery, $options: "i" };
  }

  // --- Sorting ---
  // const sort = {};

  // console.log(req.query);

  // if (req.query.sortBy) {
  //   // Split the sortBy query parameter into field and direction
  //   const [field, direction] = req.query.sortBy.split(":");

  //   // Validate the direction (default to descending if invalid)
  //   const sortDirection = direction === "asc" ? 1 : -1;

  //   // Add validation for allowed sort fields if necessary
  //   if (field) {
  //     sort[field] = sortDirection;
  //   } else {
  //     console.error("Invalid sort field provided");
  //   }
  // } else {
  //   // Default sort: newest first
  //   sort.createdAt = -1;
  // }

  // console.log(sort);

  // --- Database Queries ---

  // Count documents matching the filter
  const filteredCount = await Ledger.countDocuments(filter);

  // Count total documents for the specific dbId and retailerId
  const totalCount = await Ledger.countDocuments({
    dbId: filter.dbId,
  });

  // Fetch the paginated list with population
  const ledgerList = await Ledger.find(filter)
    .populate([
      {
        path: "billId",
        select: ""
       
      },
      {
        path: "collectionId",
        select: "",
      },
      {
        path: "creditNoteId",
        select: "",
      },
      // {
      //   path: "debitNoteId",
      //   select: "",
      // },
      {
        path: "retailerId",
        select: "",
      },
      {
        path: "dbId",
        select: "",
      },
    ])
    .sort({ createdAt: req.query.sortBy ? req.query.sortBy : -1 })
    .skip(skip)
    .limit(limit)
    
 

  // --- Response ---
  res.status(200).json({
    status: 200,
    message: "Ledger Paginated List Fetched Successfully",
    data: ledgerList,
    pagination: {
      currentPage: page,
      limit: limit,
      filteredCount,
      totalPages: Math.ceil(filteredCount / limit),
      totalCount,
    },
  });
});

module.exports = { ledgerPaginatedList };
