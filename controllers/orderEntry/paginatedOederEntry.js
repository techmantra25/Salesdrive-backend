const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OutletApproved = require("../../models/outletApproved.model");

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
      fromDate,
      toDate,
      status,
    } = req.query;

    let query = { distributorId };

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

    if (salesmanName && salesmanName !== "all") query.salesmanName = salesmanName;
    if (routeId && routeId !== "all") query.routeId = routeId;
    if (orderType && orderType !== "all") query.orderType = orderType;
    if (orderSource && orderSource !== "all") query.orderSource = orderSource;
    if (paymentMode && paymentMode !== "all") query.paymentMode = paymentMode;
    if (status && status !== "all") query.status = status;

    // --------------------------------------------------
    // RETAILER NAME FILTER
    // --------------------------------------------------
    if (retailerId && retailerId !== "all") {
      query.retailerId = retailerId;
    }

    // --------------------------------------------------
    // RETAILER PHONE FILTER (Normalize both schema + frontend)
    // --------------------------------------------------
    if (retailerPhone && retailerPhone !== "all") {
     

      // Normalize frontend phone → last 10 digits
      const frontendDigits = retailerPhone.replace(/\D/g, "").slice(-10);
      // Get retailers (we will filter manually)
      const allRetailers = await OutletApproved.find({}, { _id: 1, mobile1: 1 });

      // Normalize schema numbers → last 10 digits
      const matchedRetailers = allRetailers.filter((r) => {
        const schemaDigits = (r.mobile1 || "").replace(/\D/g, "").slice(-10);
        return schemaDigits === frontendDigits;
      });

      if (matchedRetailers.length === 0) {
        return res.status(200).json({
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
      }

      // Apply phone filter only if retailerId is NOT already selected
      if (!retailerId || retailerId === "all") {
        query.retailerId = { $in: matchedRetailers.map((r) => r._id) };
      }
    }

    // --------------------------------------------------
    // OUTLET CODE FILTER
    // --------------------------------------------------
    if (outletCode && outletCode !== "all") {
      const outlet = await OutletApproved.findOne(
        { outletCode },
        { _id: 1 }
      );

      if (!outlet) {
        return res.status(200).json({
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
      }

      // Apply outletCode filter ONLY if retailerId is not already set
      if (!retailerId || retailerId === "all") {
        query.retailerId = outlet._id;
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
    console.log("Error:", error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderEntry };
