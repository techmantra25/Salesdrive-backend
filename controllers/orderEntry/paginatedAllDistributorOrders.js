const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

// Get All Order Entries from All Distributors with Distributor Order Source Only
const paginatedAllDistributorOrders = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      distributorId,
      retailerId,
      fromDate,
      toDate,
      search,
    } = req.query;

    // Base query - only orders with orderSource 'Distributor'
    let query = { orderSource: "Distributor" };

    // Apply distributor filter
    if (distributorId) {
      query.distributorId = distributorId;
    }

    // Apply retailer filter
    if (retailerId) {
      query.retailerId = retailerId;
    }

    // Add date filter for createdAt field
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endOfDay;
      }
    }

    // Handle search functionality
    if (search) {
      const searchRegex = { $regex: search, $options: "i" };

      // Create search conditions for multiple fields
      query.$or = [{ orderNo: searchRegex }, { remark: searchRegex }];
    }

    // Fetch the data with pagination
    const orderEntries = await OrderEntry.find(query)
      .populate([
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "salesmanName",
          select: "",
        },
        {
          path: "routeId",
          select: "",
        },
        {
          path: "retailerId",
          select: "",
        },
        {
          path: "lineItems.product",
          select: "name product_code",
        },
        {
          path: "lineItems.price",
          select: "",
        },
        {
          path: "lineItems.inventoryId",
          select: "availableQty",
        },
        {
          path: "billIds",
          select: "",
        },
      ])
      .sort({ createdAt: -1 }) // Sort by most recent first
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Count the total entries based on the same filter
    const totalCount = await OrderEntry.countDocuments(query);
    const totalItems = await OrderEntry.countDocuments({
      orderSource: "Distributor",
    });
    const totalActiveCount = await OrderEntry.countDocuments({
      ...query,
    });
    // Return the result
    return res.status(200).json({
      status: 200,
      message: "All distributor orders list",
      data: orderEntries,
      pagination: {
        currentPage: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        totalItems,
        filteredCount: totalActiveCount,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedAllDistributorOrders };
