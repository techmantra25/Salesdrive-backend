const asyncHandler = require("express-async-handler");
const PriceCSV = require("../../models/priceCsv.model");

const priceCSVPaginatedList = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    // Build query object
    const query = {};
    if (status) query.status = status;

    // Count total matching documents
    const filteredCount = await PriceCSV.countDocuments(query);

    // Fetch paginated data
    const loadSheetList = await PriceCSV.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    return res.status(200).json({
      status: 200,
      message: "Price CSV paginated list fetched successfully",
      data: loadSheetList,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { priceCSVPaginatedList };
