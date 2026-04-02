const asyncHandler = require("express-async-handler");
const LedgerCollection = require("../../models/ledgerCollection.model");
const OutletApproved = require("../../models/outletApproved.model");

const paginatedLedgerCollectionList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      retailerId,
      collectionType,
      collectionNo,
      fromDate,
      toDate,
      retailerPhone,
      outletCode,
      dbId,
    } = req.query;

    // Build search query object
    let query = {};

    if (dbId) query.distributorId = dbId;

    // --------------------------------------------------
    // RETAILER FILTER (ID → PHONE → OUTLET CODE)
    // --------------------------------------------------
    let resolvedRetailerId = retailerId || null;

    if (!resolvedRetailerId && retailerPhone) {
      const outlet = await OutletApproved.findOne({
        mobile1: retailerPhone,
        status: true,
      }).select("_id");

      if (outlet) resolvedRetailerId = outlet._id;
    }

    if (!resolvedRetailerId && outletCode) {
      const outlet = await OutletApproved.findOne({
        outletCode: outletCode,
        status: true,
      }).select("_id");

      if (outlet) resolvedRetailerId = outlet._id;
    }

    if (resolvedRetailerId) {
      query.retailerId = resolvedRetailerId;
    }

    // --------------------------------------------------
    if (collectionType) query.collectionType = collectionType;
    if (collectionNo) query.collectionNo = collectionNo;

    // --------------------------------------------------
    // DATE FILTER
    // --------------------------------------------------
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

    // Fetch the data with pagination
    const LedgerCollectionList = await LedgerCollection.find(query)
      .populate([
        { path: "distributorId", select: "" },
        { path: "retailerId", select: "" },
        { path: "lineItems.billId", select: "" },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Count the total entries based on the same filter (filtered count)
    const filteredCount = await LedgerCollection.countDocuments(query);

    // Count the total number of active bills (without filters)
    const totalActiveCount = await LedgerCollection.countDocuments({});

    return res.status(200).json({
      status: 200,
      message: "Ledger collection list",
      data: LedgerCollectionList,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount: filteredCount,
        totalActiveCount: totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedLedgerCollectionList };
