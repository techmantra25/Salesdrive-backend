const asyncHandler = require("express-async-handler");
const Replacement = require("../../models/replacement.model");

const paginatedReplacementReport = asyncHandler(async (req, res) => {
  try {
    let { page, limit, fromDate, toDate, outletId, replacementType, status } =
      req.query;

    // Convert query params to numbers and set default values
    page = parseInt(page) ?? 1;
    limit = parseInt(limit) ?? 10;

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        status: 400,
        message: "Page and limit should be positive integers",
      });
    }

    const skip = (page - 1) * limit;

    // Build the query object for filters
    const query = {};

    // Filter by date range (fromDate and toDate)
    if (fromDate || toDate) {
      query.replacementDate = {};
      if (fromDate) {
        // Set fromDate to the start of the day
        query.replacementDate.$gte = new Date(
          new Date(fromDate).setHours(0, 0, 0, 0)
        );
      }
      if (toDate) {
        // Set toDate to the end of the day
        query.replacementDate.$lte = new Date(
          new Date(toDate).setHours(23, 59, 59, 999)
        );
      }
    }

    // Filter by outletId
    if (outletId) {
      query.outletId = outletId;
    }

    // Filter by replacementType
    if (replacementType) {
      query.replacementType = replacementType;
    }

    if (status) {
      query.status = status;
    }

    // Fetch replacements with pagination and filters
    const replacementList = await Replacement.find(query)
      .populate([
        {
          path: "lineItems.product",
          select: "",
        },
        {
          path: "lineItems.inventoryId",
          select: "",
        },
        {
          path: "lineItems.adjustmentId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "outletId",
          select: "",
        },
        { path: "billId", select: "" },
        { path: "salesReturnId", select: "" },
        {
          path: "adjustedBillIds.billId",
          select: "billNo orderNo", // Or specify required fields
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    // Count total documents for pagination metadata
    const totalCount = await Replacement.countDocuments(query);
    const totalCountWithoutFilter = await Replacement.countDocuments();

    return res.status(200).json({
      status: 200,
      message: "Paginated replacement list with filters",
      data: replacementList,
      pagination: {
        totalPages: Math.ceil(totalCount / limit),
        filteredItems: totalCount,
        totalItems: totalCountWithoutFilter,
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedReplacementReport };
