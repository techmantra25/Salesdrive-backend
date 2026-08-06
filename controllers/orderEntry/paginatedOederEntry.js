const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OutletApproved = require("../../models/outletApproved.model");

// Splits a comma-separated query param (or accepts an already-parsed array)
// into a clean array of trimmed, non-empty values. Returns [] for "all",
// empty string, undefined, etc.
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
const paginatedOrderEntry = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user.id;

    const {
      page = 1,
      limit = 10,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      retailerPhone,
      outletCode,
      orderType,
      orderSource,
      paymentMode,
      cso,
      fromDate,
      toDate,
      status,
    } = req.query;

    let query = { distributorId };
    // console.log("raw retailerId param:", req.query.retailerId, typeof req.query.retailerId);

    const emptyResponse = () =>
      res.status(200).json({
        status: 200,
        message: "Order entries list",
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

    // --------------------------------------------------
    // ORDER NUMBER FILTER
    // --------------------------------------------------
    if (orderNo) {
      const log = await SecondaryOrderEntryLog.findOne({ Order_Id: orderNo });
      if (log) {
        query.secondaryOrderEntryLogId = log._id;
      } else {
        query.orderNo = { $regex: orderNo, $options: "i" };
      }
    }

    // --------------------------------------------------
    // SIMPLE MULTI-VALUE FILTERS ($in when more than one value given)
    // --------------------------------------------------
    const salesmanNameArr = toArray(salesmanName);
    if (salesmanNameArr.length === 1) query.salesmanName = salesmanNameArr[0];
    else if (salesmanNameArr.length > 1) query.salesmanName = { $in: salesmanNameArr };

    const routeIdArr = toArray(routeId);
    if (routeIdArr.length === 1) query.routeId = routeIdArr[0];
    else if (routeIdArr.length > 1) query.routeId = { $in: routeIdArr };

    const orderTypeArr = toArray(orderType);
    if (orderTypeArr.length === 1) query.orderType = orderTypeArr[0];
    else if (orderTypeArr.length > 1) query.orderType = { $in: orderTypeArr };

    const orderSourceArr = toArray(orderSource);
    if (orderSourceArr.length === 1) query.orderSource = orderSourceArr[0];
    else if (orderSourceArr.length > 1) query.orderSource = { $in: orderSourceArr };

    const paymentModeArr = toArray(paymentMode);
    if (paymentModeArr.length === 1) query.paymentMode = paymentModeArr[0];
    else if (paymentModeArr.length > 1) query.paymentMode = { $in: paymentModeArr };

    const statusArr = toArray(status);
    if (statusArr.length === 1) query.status = statusArr[0];
    else if (statusArr.length > 1) query.status = { $in: statusArr };

    // --------------------------------------------------
    // CSO FILTER
    // CSO can live on the order itself (order.cso) OR only on the outlet
    // (retailerId.cso) — the frontend displays retailerId.cso, so the filter
    // must match against BOTH sources via $or, not just the order's own
    // field, otherwise a selected CSO can silently exclude/include the wrong
    // rows whenever the two values diverge or one is unset.
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
    // RETAILER NAME FILTER (multi)
    // --------------------------------------------------
    const retailerIdArr = toArray(retailerId);
    // console.log("Raw retailerId:", retailerId);
    // console.log("Retailer Array:", retailerIdArr);
    if (retailerIdArr.length === 1) query.retailerId = retailerIdArr[0];
    else if (retailerIdArr.length > 1) query.retailerId = { $in: retailerIdArr };

    // --------------------------------------------------
    // RETAILER PHONE FILTER (multi, normalize both schema + frontend)
    // --------------------------------------------------
    const retailerPhoneArr = toArray(retailerPhone);
    if (retailerPhoneArr.length > 0) {
      // Normalize frontend phones -> last 10 digits
      const frontendDigitsSet = new Set(
        retailerPhoneArr.map((p) => p.replace(/\D/g, "").slice(-10))
      );

      // Get retailers (we will filter manually)
      const allRetailers = await OutletApproved.find({}, { _id: 1, mobile1: 1 });

      // Normalize schema numbers -> last 10 digits
      const matchedRetailers = allRetailers.filter((r) => {
        const schemaDigits = (r.mobile1 || "").replace(/\D/g, "").slice(-10);
        return frontendDigitsSet.has(schemaDigits);
      });

      if (matchedRetailers.length === 0) {
        return emptyResponse();
      }

      const matchedIds = matchedRetailers.map((r) => r._id);

      // Apply phone filter only if retailerId is NOT already selected
      if (retailerIdArr.length === 0) {
        query.retailerId =
          matchedIds.length === 1 ? matchedIds[0] : { $in: matchedIds };
      }
    }

    // --------------------------------------------------
    // OUTLET CODE FILTER (multi)
    // --------------------------------------------------
    const outletCodeArr = toArray(outletCode);
    if (outletCodeArr.length > 0) {
      const outlets = await OutletApproved.find(
        { outletCode: { $in: outletCodeArr } },
        { _id: 1 }
      );

      if (outlets.length === 0) {
        return emptyResponse();
      }

      // Apply outletCode filter ONLY if retailerId is not already set
      if (retailerIdArr.length === 0 && retailerPhoneArr.length === 0) {
        const outletIds = outlets.map((o) => o._id);
        query.retailerId =
          outletIds.length === 1 ? outletIds[0] : { $in: outletIds };
      }
    }

    // --------------------------------------------------
    // APPLY CSO OR-CONDITION
    // Combine "order.cso matches" OR "order.retailerId is one of the outlets
    // whose cso matches" — if retailerId is already constrained by another
    // filter above (retailer/phone/outletCode), AND them together via $and
    // so CSO further narrows rather than silently overriding the existing
    // retailerId constraint.
    // --------------------------------------------------
    if (csoArr.length > 0) {
      const csoFilter = csoArr.length === 1 ? csoArr[0] : { $in: csoArr };

      const csoOrConditions = [{ cso: csoFilter }];
      if (csoOutletIds.length > 0) {
        csoOrConditions.push({
          retailerId: csoOutletIds.length === 1 ? csoOutletIds[0] : { $in: csoOutletIds },
        });
      }

      if (query.retailerId) {
        // retailerId already constrained elsewhere — narrow further via $and
        query.$and = (query.$and || []).concat([{ $or: csoOrConditions }]);
      } else {
        query.$or = csoOrConditions;
      }
    }

    // --------------------------------------------------
    // DATE RANGE FILTER
    // --------------------------------------------------
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

    // --------------------------------------------------
    // FETCH ORDER DATA
    // --------------------------------------------------
    // console.log("Final query:", JSON.stringify(query));
    // console.log("Retailer Param:", retailerId);
    // console.log("Retailer Array:", retailerIdArr);
    // console.log("Mongo Query:", JSON.stringify(query, null, 2));
    const orderEntries = await OrderEntry.find(query)
      .populate([
        { path: "distributorId" },
        { path: "salesmanName" },
        { path: "routeId" },
        { path: "retailerId" },
        { path: "lineItems.product" },
        { path: "lineItems.price" },
        { path: "lineItems.inventoryId" },
        { path: "billIds" },
        { path: "secondaryOrderEntryLogId", select: "Order_Id OrderData" },
        { path: "orderEnquiryId", select: "enquiryNo" },
        {
          path: "adjustedCreditNoteIds.creditNoteId",
          model: "CreditNote",
          select:
            "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
        },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const totalCount = await OrderEntry.countDocuments(query);

    return res.status(200).json({
      status: 200,
      message: "Order entries list",
      data: orderEntries,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        filteredCount: totalCount,
        totalActiveCount: totalCount,
      },
    });

  } catch (error) {
    // console.log("Error name:", error.name);
    // console.log("Error message:", error.message);
    // console.log("Error stack:", error.stack);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderEntry };