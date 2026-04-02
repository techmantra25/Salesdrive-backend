const asyncHandler = require("express-async-handler");
const SalesReturn = require("../../models/salesReturn.model");

const paginatedSalesReturnReport = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      billNo,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      fromDate,
      toDate,
      billStatus,
      goodsType,
    } = req.query;

    // Build search query object
    let query = {};

    if (salesmanName) query.salesmanName = salesmanName;
    if (routeId) query.routeId = routeId;
    if (retailerId) query.retailerId = retailerId;
    if (goodsType) query.goodsType = goodsType;
    if (billStatus) query.status = billStatus;

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

    // Build populate options
    const populateOptions = [
      { path: "distributorId", select: "" },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      { path: "billId", select: "" }, // Fetching billNo and orderNo
      { path: "retailerId", select: "" },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" },
    ];

    // Fetch the data with pagination and populate
    let SalesReturnListQuery = SalesReturn.find(query)
      .populate(populateOptions)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    let SalesReturnList = await SalesReturnListQuery.exec();

    // Apply billNo and orderNo filter after population
    if (billNo || orderNo) {
      SalesReturnList = SalesReturnList.filter((item) => {
        const bill = item.billId;
        if (!bill) return false;

        // Filter conditions
        const billNoMatch = billNo
          ? new RegExp(billNo, "i").test(bill.billNo)
          : true;
        const orderNoMatch = orderNo
          ? new RegExp(orderNo, "i").test(bill.orderNo)
          : true;

        return billNoMatch && orderNoMatch;
      });
    }

    // Count filtered records
    const filteredCount = SalesReturnList.length;

    // Get total count without filters
    const totalActiveCount = await SalesReturn.countDocuments();

    // Return the result
    return res.status(200).json({
      status: 200,
      message: "SalesReturn list",
      data: SalesReturnList,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalActiveCount / limit),
        filteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedSalesReturnReport };
