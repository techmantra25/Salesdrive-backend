const asyncHandler = require("express-async-handler");
const LoadSheet = require("../../models/loadSheet.model");
const Bill = require("../../models/bill.model");

const paginatedList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      allocationNo,
      vehicleId,
      deliveryBoyId,
      beatId,
      retailerId,
      fromDate,
      toDate,
      billNo,
      distributorId,
    } = req.query;

    // Build the search query object
    let query = {};

    if (allocationNo) query.allocationNo = allocationNo;
    if (vehicleId) query.vehicleId = vehicleId;
    if (deliveryBoyId) query.deliveryBoyId = deliveryBoyId;
    if (beatId) query.beatId = beatId;
    if (retailerId) query.retailerId = retailerId;
    if (distributorId) query.distributorId = distributorId;

    // Add date filter for createdAt field
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0); // Set to the start of the day
        query.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999); // Set to the end of the day
        query.createdAt.$lte = endOfDay;
      }
    }

    // If billNo is provided, fetch bill IDs that match the billNo
    if (billNo) {
      const bills = await Bill.find({ billNo: billNo }, "_id");
      const billIds = bills.map((bill) => bill._id);
      query.billIds = { $in: billIds };
    }

    // Fetch the data with pagination
    const loadSheetList = await LoadSheet.find(query)
      .populate([
        { path: "billIds", select: "" },
        { path: "vehicleId", select: "" },
        { path: "deliveryBoyId", select: "" },
        { path: "beatId", select: "" },
        { path: "retailerId", select: "" },
      ])
      .sort({ _id: -1 }) // Sort by most recent first
      .skip((page - 1) * limit)
      .limit(limit);

    // Count the total entries based on the same filter (filtered count)
    const filteredCount = await LoadSheet.countDocuments(query);

    // Count the total number of active bills (without filters)
    const totalActiveCount = await LoadSheet.countDocuments({});

    // Return the result
    return res.status(200).json({
      status: 200,
      message: "LoadSheet list",
      data: loadSheetList,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount: filteredCount, // This is the count of bills matching the filters
        totalActiveCount: totalActiveCount, // This is the total count of bills
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedList };
