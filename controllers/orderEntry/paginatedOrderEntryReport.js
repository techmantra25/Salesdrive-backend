const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

// Get All Order Entries Paginated with Search Filters
const paginatedOrderEntryReport = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;
    const {
      page = 1,
      limit = 10,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
      fromDate,
      toDate,
      status,
    } = req.query;

    // Build search query object
    let query = { distributorId };

    if (orderNo) query.orderNo = { $regex: orderNo, $options: "i" };
    if (salesmanName) query.salesmanName = salesmanName;
    if (routeId) query.routeId = routeId;
    if (retailerId) query.retailerId = retailerId;
    if (orderType) query.orderType = orderType;
    if (orderSource) query.orderSource = orderSource;
    if (paymentMode) query.paymentMode = paymentMode;
    if (status) query.status = status;

    // Add date filter for createdAt field
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0); // Set to the start of the day
        query.createdAt.$gte = startOfDay; // Filter from this date
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999); // Set to the end of the day
        query.createdAt.$lte = endOfDay; // Filter up to this date
      }
    }

    // Fetch the data with pagination
    const orderEntries = await OrderEntry.find(query)
      .populate([
        {
          path: "distributorId",
          select: "dbCode name stateId city",
          populate: {
            path: "stateId",
            select: "name zoneId",
            populate: {
              path: "zoneId",
              select: "name",
            },
          },
        },
        {
          path: "salesmanName",
          select: "",
          populate: [
            {
              path: "desgId",
              select: "",
            },
            {
              path: "empMappingId",
              select: "",
              populate: [
                {
                  path: "empId",
                  select: "name",
                },
                {
                  path: "rmEmpId",
                  select: "",
                  populate: [
                    {
                      path: "desgId",
                      select: "name",
                    },
                    {
                      path: "empMappingId",
                      select: "",
                      populate: [
                        {
                          path: "empId",
                          select: "name",
                        },
                        {
                          path: "rmEmpId",
                          select: "",
                          populate: [
                            {
                              path: "desgId",
                              select: "name",
                            },
                            {
                              path: "empMappingId",
                              select: "",
                              populate: [
                                {
                                  path: "empId",
                                  select: "name",
                                },
                                {
                                  path: "rmEmpId",
                                  select: "",
                                  populate: [
                                    {
                                      path: "desgId",
                                      select: "name",
                                    },
                                    {
                                      path: "empMappingId",
                                      select: "",
                                      populate: [
                                        {
                                          path: "empId",
                                          select: "name",
                                        },
                                        {
                                          path: "rmEmpId",
                                          select: "",
                                          populate: [
                                            {
                                              path: "desgId",
                                              select: "name",
                                            },
                                            {
                                              path: "empMappingId",
                                              select: "",
                                              populate: [
                                                {
                                                  path: "empId",
                                                  select: "name",
                                                },
                                                {
                                                  path: "rmEmpId",
                                                  select: "",
                                                },
                                              ],
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { path: "routeId", select: "" },
        {
          path: "retailerId",
          select: "",
          populate: [
            {
              path: "zoneId",
              select: "",
            },
            {
              path: "stateId",
              select: "",
            },
            {
              path: "regionId",
              select: "",
            },
          ],
        },
        {
          path: "lineItems.product",
          select: "",
          populate: [
            {
              path: "cat_id",
              select: "",
            },
            {
              path: "collection_id",
              select: "",
            },
            {
              path: "brand",
              select: "",
            },
          ],
        },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        {
          path: "billIds",
          select: "",
          populate: [
            {
              path: "lineItems.product",
              select: "",
              populate: [
                {
                  path: "cat_id",
                  select: "",
                },
                {
                  path: "collection_id",
                  select: "",
                },
                {
                  path: "brand",
                  select: "",
                },
              ],
            },
            {
              path: "lineItems.price",
              select: "",
            },
            {
              path: "lineItems.inventoryId",
              select: "",
            },
            {
              path:"salesReturnId",
              select:"",
            }
          ],
        },
      ])
      .sort({ _id: -1 }) // Sort by most recent first
      .skip((page - 1) * limit)
      .limit(limit);

    // Count the total entries based on the same filter
    const totalCount = await OrderEntry.countDocuments(query);
    const totalActiveCount = await OrderEntry.countDocuments({
      ...query,
    });

    // Return the result
    return res.status(200).json({
      status: 200,
      message: "Order entries list",
      data: orderEntries,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        filteredCount: totalActiveCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderEntryReport };
