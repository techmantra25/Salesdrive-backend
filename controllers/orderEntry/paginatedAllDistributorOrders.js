const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const State = require("../../models/state.model");

const toArray = (val) => {
  if (!val || val === "all") return [];

  if (Array.isArray(val)) {
    return val
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return String(val)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

// Get All Order Entries from All Distributors with Distributor Order Source Only
const paginatedAllDistributorOrders = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      distributorId,
      retailerId,
      godownId,
      salesmanName,
      cso,
      routeId,
      zoneId,
      status,
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

    // Apply godown filter
    if (godownId) {
      query.godownId = godownId;
    }

    // --------------------------------------------------
    // SALESMAN FILTER (multi)
    // --------------------------------------------------
    const salesmanNameArr = toArray(salesmanName);
    if (salesmanNameArr.length === 1) query.salesmanName = salesmanNameArr[0];
    else if (salesmanNameArr.length > 1)
      query.salesmanName = { $in: salesmanNameArr };

    // --------------------------------------------------
    // ROUTE FILTER (multi)
    // --------------------------------------------------
    const routeIdArr = toArray(routeId);
    if (routeIdArr.length === 1) query.routeId = routeIdArr[0];
    else if (routeIdArr.length > 1) query.routeId = { $in: routeIdArr };

    // --------------------------------------------------
    // ORDER STATUS FILTER (multi)
    // --------------------------------------------------
    const statusArr = toArray(status);
    if (statusArr.length === 1) query.status = statusArr[0];
    else if (statusArr.length > 1) query.status = { $in: statusArr };

    // --------------------------------------------------
    // CSO FILTER
    // --------------------------------------------------
    const csoArr = toArray(cso);
    let csoOutletIds = [];
    if (csoArr.length > 0) {
      const csoFilter = csoArr.length === 1 ? csoArr[0] : { $in: csoArr };

      const matchedOutlets = await OutletApproved.find(
        { cso: csoFilter },
        { _id: 1 }
      );
      csoOutletIds = matchedOutlets.map((o) => o._id);
    }

    // --------------------------------------------------
    // ZONE FILTER
    // Resolve zone -> states -> outlets, then constrain retailerId, unless
    // retailerId is already set by a direct selection above.
    // --------------------------------------------------
    if (zoneId && zoneId !== "all") {
      const zoneFilter = toArray(zoneId);

      const matchedStates = await State.find(
        { zoneId: { $in: zoneFilter } },
        { _id: 1 }
      );

      const stateIds = matchedStates.map((state) => state._id);

      const matchedOutlets = await OutletApproved.find(
        { stateId: { $in: stateIds } },
        { _id: 1 }
      );

      const outletIds = matchedOutlets.map((outlet) => outlet._id);

      if (!query.retailerId) {
        query.retailerId =
          outletIds.length === 1 ? outletIds[0] : { $in: outletIds };
      }
    }

    // --------------------------------------------------
    // APPLY CSO OR-CONDITION
    // If retailerId is already constrained by another filter above, AND the
    // CSO condition in so it narrows rather than overrides it.
    // --------------------------------------------------
    if (csoArr.length > 0) {
      const csoFilter = csoArr.length === 1 ? csoArr[0] : { $in: csoArr };

      const csoOrConditions = [{ cso: csoFilter }];
      if (csoOutletIds.length > 0) {
        csoOrConditions.push({
          retailerId:
            csoOutletIds.length === 1 ? csoOutletIds[0] : { $in: csoOutletIds },
        });
      }

      if (query.retailerId) {
        query.$and = (query.$and || []).concat([{ $or: csoOrConditions }]);
      } else {
        query.$or = csoOrConditions;
      }
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
      query.$or = (query.$or || []).concat([
        { orderNo: searchRegex },
        { remark: searchRegex },
      ]);
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
          path: "godownId",
          select: "godownName",
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