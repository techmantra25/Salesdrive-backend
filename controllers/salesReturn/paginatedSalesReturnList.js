const asyncHandler = require("express-async-handler");
const SalesReturn = require("../../models/salesReturn.model");
const OutletApproved = require("../../models/outletApproved.model");


const paginatedSalesReturnList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      billNo,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      retailerPhone,
      outletCode,
      salesReturnNo,
      fromDate,
      toDate,
      billStatus,
      goodsType,
      distributorId,
    } = req.query;

    // Build search query object
    let query = {};
    console.log("Outlet Code",outletCode)

    if (salesmanName) query.salesmanName = salesmanName;
    if (routeId) query.routeId = routeId;
    if (!retailerPhone && !outletCode && retailerId) {
  query.retailerId = retailerId;
}

    if (goodsType) query.goodsType = goodsType;
    if (billStatus) query.status = billStatus;
    if (distributorId) query.distributorId = distributorId;
    if (salesReturnNo) query.salesReturnNo = { $regex: salesReturnNo, $options: "i" };
    
    // ----------------------------------
// Retailer Phone & Outlet Code filter
// ----------------------------------
if (retailerPhone || outletCode) {
  const outletQuery = {};

  if (retailerPhone) {
    const digits = retailerPhone.replace(/\D/g, "");
    outletQuery.$or = [
      { mobile1: { $regex: digits } },
      { "sourceData.Phone1": { $regex: digits } },
    ];
  }

  if (outletCode) {
    outletQuery.outletCode = outletCode;
  }

  const matchingOutlets = await OutletApproved
    .find(outletQuery)
    .select("_id");

  const outletIds = matchingOutlets.map((o) => o._id);

  // no matching retailer → empty result
  if (outletIds.length === 0) {
    return res.status(200).json({
      status: 200,
      message: "SalesReturn list",
      data: [],
      pagination: {
        currentPage: page,
        limit,
        totalPages: 0,
        filteredCount: 0,
        totalActiveCount: 0,
      },
    });
  }

  query.retailerId = { $in: outletIds };
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
    const filteredCount = await SalesReturn.countDocuments(query);

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
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedSalesReturnList };
