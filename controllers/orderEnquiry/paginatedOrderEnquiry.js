const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const OutletApproved = require("../../models/outletApproved.model");
// NOTE: Assumed model path/name for State — update if your State model
// lives elsewhere or is named differently. State documents are expected
// to carry a `zoneId` field, and OutletApproved documents are expected
// to carry `stateId` and `district` fields (as seen in existing outlet data).
const State = require("../../models/state.model");

const paginatedOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user.id;

    const {
      page = 1,
      limit = 10,
      enquiryNo,
      employeeId,
      routeId,
      retailerId,
      retailerPhone,
      outletCode,
      zoneId,
      districtId,
      orderType,
      orderSource,
      paymentMode,
      fromDate,
      toDate,
      status,
    } = req.query;

    const query = { distributorId };

    // Helper: turns "id1,id2,id3" into a Mongo $in filter (also works for a single id)
    const toInFilter = (value) => {
      const ids = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      return ids.length > 0 ? { $in: ids } : undefined;
    };

    if (enquiryNo) query.enquiryNo = { $regex: enquiryNo, $options: "i" };

    if (routeId && routeId !== "all") {
      const filter = toInFilter(routeId);
      if (filter) query.routeId = filter;
    }

    if (orderType && orderType !== "all") query.orderType = orderType;
    if (orderSource && orderSource !== "all") query.orderSource = orderSource;
    if (paymentMode && paymentMode !== "all") query.paymentMode = paymentMode;

    if (status && status !== "all") {
      const filter = toInFilter(status);
      query.status = filter || status;
    } else {
      // By default don't show closed enquiries
      query.status = { $ne: "Closed" };
    }

    // Collect outlet-id constraints from every filter that narrows down retailerId.
    // We intersect them all at the end instead of letting one filter silently
    // overwrite another when multiple are applied together (e.g. Salesman + Retailer).
    let retailerIdConstraints = [];

    if (retailerId && retailerId !== "all") {
      const ids = retailerId
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (ids.length > 0) retailerIdConstraints.push(ids);
    }

    if (employeeId && employeeId !== "all") {
      const employeeFilter = toInFilter(employeeId);
      const matchedOutlets = await OutletApproved.find(
        employeeFilter ? { employeeId: employeeFilter } : {},
        { _id: 1 }
      );
      retailerIdConstraints.push(matchedOutlets.map((outlet) => outlet._id.toString()));
    }

    if (retailerPhone && retailerPhone !== "all") {
      const frontendDigits = retailerPhone.replace(/\D/g, "").slice(-10);
      const allRetailers = await OutletApproved.find({}, { _id: 1, mobile1: 1 });
      const matchedRetailers = allRetailers.filter((retailer) => {
        const schemaDigits = (retailer.mobile1 || "")
          .replace(/\D/g, "")
          .slice(-10);
        return schemaDigits === frontendDigits;
      });
      retailerIdConstraints.push(matchedRetailers.map((retailer) => retailer._id.toString()));
    }

    if (outletCode && outletCode !== "all") {
      const outlet = await OutletApproved.findOne({ outletCode }, { _id: 1 });
      retailerIdConstraints.push(outlet ? [outlet._id.toString()] : []);
    }

    if (zoneId && zoneId !== "all") {
      const zoneFilter = toInFilter(zoneId);
      const matchedStates = await State.find(
        zoneFilter ? { zoneId: zoneFilter } : {},
        { _id: 1 }
      );
      const stateIds = matchedStates.map((state) => state._id);

      const matchedOutlets = await OutletApproved.find(
        { stateId: { $in: stateIds } },
        { _id: 1 }
      );
      retailerIdConstraints.push(matchedOutlets.map((outlet) => outlet._id.toString()));
    }

    if (districtId && districtId !== "all") {
      const districtFilter = toInFilter(districtId);
      const matchedOutlets = await OutletApproved.find(
        districtFilter ? { district: districtFilter } : {},
        { _id: 1 }
      );
      retailerIdConstraints.push(matchedOutlets.map((outlet) => outlet._id.toString()));
    }

    // Intersect all constraint sets (if any filters were applied)
    if (retailerIdConstraints.length > 0) {
      const intersected = retailerIdConstraints.reduce((acc, ids) => {
        const idSet = new Set(ids);
        return acc.filter((id) => idSet.has(id));
      });

      if (intersected.length === 0) {
        return res.status(200).json({
          status: 200,
          message: "Order enquiries list",
          data: [],
          pagination: {
            currentPage: Number(page),
            limit: Number(limit),
            totalPages: 0,
            totalCount: 0,
            filteredCount: 0,
            totalActiveCount: 0,
          },
        });
      }

      query.retailerId = { $in: intersected };
    }

    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }

      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const orderEnquiries = await OrderEnquiry.find(query)
      .populate([
        { path: "distributorId" },
        { path: "salesmanName" },
        { path: "routeId" },
        {
          path: "retailerId",
          populate: { path: "employeeId" },   // <-- resolves outlet's assigned salesman
        },
        { path: "lineItems.product" },
        { path: "lineItems.price" },
        { path: "lineItems.inventoryId" },
        { path: "convertedOrderEntryId", select: "orderNo invoiceAmount" },
        {
          path: "adjustedCreditNoteIds.creditNoteId",
          model: "CreditNote",
          select:
            "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
        },
      ])
      .sort({ _id: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const totalCount = await OrderEnquiry.countDocuments(query);

    return res.status(200).json({
      status: 200,
      message: "Order enquiries list",
      data: orderEnquiries,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
        totalCount,
        filteredCount: totalCount,
        totalActiveCount: totalCount,
      },
    });
  } catch (error) {
    console.log("Error:", error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderEnquiry };