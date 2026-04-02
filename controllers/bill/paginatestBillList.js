const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const OutletApproved = require("../../models/outletApproved.model");


const paginatedBillList = asyncHandler(async (req, res) => {
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
      retailerPhone,
      outletCode,
      toDate,
      billStatus,
      loadSheetExist,
      exclude,
      distributorId,
      deliveredOrCancelledDate,
    } = req.query;
    // Build search query object
    let query = {};

    if (loadSheetExist !== undefined && loadSheetExist !== null) {
      query.loadSheetId = { $exists: loadSheetExist === "true" };
    }
    if (billNo) {
      query.$or = [
        { billNo: { $regex: billNo, $options: "i" } },
        { new_billno: { $regex: billNo, $options: "i" } },
      ];
    }
    if (orderNo) query.orderNo = { $regex: orderNo, $options: "i" };
    if (salesmanName) query.salesmanName = salesmanName;
    if (routeId) query.routeId = routeId;

    if (billStatus) query.status = billStatus;
    if (distributorId) {
      query.distributorId = distributorId;
    }
    // ----------------------------------
    // Retailer Phone & Outlet Code filter
    // ----------------------------------
    if (retailerPhone || outletCode) {
      const outletQuery = {};

      if (retailerPhone) {
        const digits = retailerPhone.replace(/\D/g, "");
        outletQuery.mobile1 = { $regex: digits };
      }

      if (outletCode) {
        outletQuery.outletCode = outletCode;
      }

      const matchingOutlets = await OutletApproved
        .find(outletQuery)
        .select("_id");

      const outletIds = matchingOutlets.map((o) => o._id);

      // no match → return empty
      if (outletIds.length === 0) {
        return res.status(200).json({
          status: 200,
          message: "Bill list",
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

    // ----------------------------------
    // Retailer dropdown fallback
    // ----------------------------------
    if (!retailerPhone && !outletCode && retailerId) {
      query.retailerId = retailerId;
    }


    const moment = require("moment-timezone");

    // Add date filter for createdAt field
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = moment
          .tz(fromDate, "Asia/Kolkata")
          .startOf("day")
          .toDate();
        query.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = moment
          .tz(toDate, "Asia/Kolkata")
          .endOf("day")
          .toDate();
        query.createdAt.$lte = endOfDay;
      }
    }

    if (
      deliveredOrCancelledDate &&
      deliveredOrCancelledDate?.startDate &&
      deliveredOrCancelledDate?.endDate
    ) {
      const start = moment
        .tz(deliveredOrCancelledDate.startDate, "Asia/Kolkata")
        .startOf("day")
        .toDate();

      const end = moment
        .tz(deliveredOrCancelledDate.endDate, "Asia/Kolkata")
        .endOf("day")
        .toDate();

      query.$or = [
        {
          status: "Delivered",
          "dates.deliveryDate": { $gte: start, $lte: end },
        },
        {
          status: "Cancelled",
          "dates.cancelledDate": { $gte: start, $lte: end },
        },
      ];
    }

    if (exclude && exclude?.ledgerCollectionStatus) {
      query.ledgerCollectionStatus = { $ne: exclude.ledgerCollectionStatus };
    }

    // Fetch the data with pagination
    const BillList = await Bill.find(query)
      .populate([
        { path: "distributorId", select: "" },
        { path: "salesmanName", select: "" },
        { path: "routeId", select: "" },
        { path: "orderId", select: "" },
        { path: "retailerId", select: "" },
        { path: "lineItems.product", select: "" },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        {
          path: "loadSheetId",
          select: "allocationNo vehicleId createdAt",
          populate: {
            path: "vehicleId",
            select: "name vehicle_no ",
          },
        },
        { path: "ledgerCollectionId", select: "" },
        {
          path: "adjustedCreditNoteIds.creditNoteId",
          model: "CreditNote",
          select:
            "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
        },
        {
          path: "adjustedReplacementIds.replacementId",
          model: "Replacement",
          select: "replacementNo replacementType lineItems",
        },
      ])
      .sort({ _id: -1 }) // Sort by most recent first
      .skip((page - 1) * limit)
      .limit(limit);

    // Count the total entries based on the same filter (filtered count)
    const filteredCount = await Bill.countDocuments(query);

    // Count the total number of active bills (without filters)
    const totalQuery = {};
    if (distributorId) {
      totalQuery.distributorId = distributorId;
    }
    const totalActiveCount = await Bill.countDocuments(totalQuery);

    // Return the result
    return res.status(200).json({
      status: 200,
      message: "Bill list",
      data: BillList,
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

module.exports = { paginatedBillList };
