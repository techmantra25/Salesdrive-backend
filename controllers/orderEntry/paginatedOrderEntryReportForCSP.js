const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

const paginatedOrderEntryReportForCSP = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
      fromDate,
      toDate,
      status,
      distributorIds,
      search,
    } = req.query;

    // Build search query object
    let query = {}; // Initialize as an empty object

    // Conditionally add distributorId filter
    if (distributorIds) {
      query.distributorId = { $in: distributorIds.split(",") };
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [{ orderNo: searchRegex }];
    }

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
    // NOTE: The populate below already includes all necessary fields for the enhanced OrderReport
    // lineItems.product includes brand, cat_id, collection_id which map to Brand, Category
    // lineItems.price includes mrp_price, rlp_price
    // The frontend will now flatten these lineItems to create one row per product
    const orderEntries = await OrderEntry.find(query)
      .populate([
        { path: "distributorId", select: "" },
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
              path: "salesReturnId",
              select: "",
            },
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
    // NOTE: The data structure is unchanged - frontend will handle flattening lineItems
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
    throw error;
  }
});

module.exports = { paginatedOrderEntryReportForCSP };
