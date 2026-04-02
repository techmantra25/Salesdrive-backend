const asyncHandler = require("express-async-handler");
const ReportRequest = require("../../models/reportRequest.model");

const reportRequestList = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    let {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate,
      type,
      searchTerm,
    } = req.query;

    // Parse query params
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // Initialize query object
    const query = { reqBy: userId };

    if (searchTerm) {
      query.code = { $regex: searchTerm, $options: "i" };
    }

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Add type filter if provided
    if (type) {
      query.type = type;
    }

    // Add date filter if provided (consider createdAt field for date filtering)
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt.$gte = new Date(startOfDay);
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.createdAt.$lte = new Date(endOfDay);
      }
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Get total count of report requests based on query filters
    const totalCount = await ReportRequest.countDocuments({
      reqBy: userId,
    });

    // Get paginated report requests based on query filters
    const reportRequests = await ReportRequest.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Calculate total filtered count (in case of filters)
    const totalFilteredCount = await ReportRequest.countDocuments(query);

    return res.status(200).json({
      status: 200,
      message: "Report request list retrieved successfully",
      data: reportRequests,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalFilteredCount / limit),
        totalCount,
        filteredCount: totalFilteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { reportRequestList };
